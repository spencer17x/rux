import { spawnSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export type ChildProcessTerminationOptions = {
  gracePeriodMs?: number;
  forceKillWaitMs?: number;
};

export type ChildProcessTerminationResult = {
  forced: boolean;
  exited: boolean;
};

const DEFAULT_GRACE_PERIOD_MS = 2_500;
const DEFAULT_FORCE_KILL_WAIT_MS = 1_000;
const POLL_INTERVAL_MS = 20;

export async function awaitAllCleanup(
  operations: Iterable<PromiseLike<unknown>>,
  label: string,
): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, `${label} cleanup failed`);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function processGroupExists(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function forceKillProcessTree(pid: number, fallbackKill: () => void): void {
  if (process.platform === "win32") {
    const executable = process.env.SystemRoot
      ? resolve(process.env.SystemRoot, "System32", "taskkill.exe")
      : "taskkill.exe";
    const result = spawnSync(executable, ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.status === 0) return;
  } else {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }
  fallbackKill();
}

export function signalChildProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid;
  if (pid && signal === "SIGKILL") {
    forceKillProcessTree(pid, () => {
      try {
        child.kill(signal);
      } catch {
        // The direct process has already exited.
      }
    });
    return;
  }
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }

  try {
    child.kill(signal);
  } catch {
    // The process has already exited or never spawned successfully.
  }
}

async function waitForProcessTreeExit(
  child: ChildProcess,
  pid: number | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    if (process.platform !== "win32" && pid) {
      if (!processGroupExists(pid)) return true;
    } else if (childExited(child)) {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(POLL_INTERVAL_MS, remaining));
  } while (true);

  return process.platform !== "win32" && pid
    ? !processGroupExists(pid)
    : childExited(child);
}

/**
 * Terminates the detached process group, not only its leader. The grace wait
 * deliberately keeps checking the group after the direct child exits because
 * provider CLIs can leave grandchildren running after their launcher stops.
 */
export async function terminateChildProcessGroup(
  child: ChildProcess,
  options: ChildProcessTerminationOptions = {},
): Promise<ChildProcessTerminationResult> {
  const pid = child.pid;
  if (
    (process.platform !== "win32" && pid && !processGroupExists(pid))
    || (process.platform === "win32" && childExited(child))
    || (!pid && childExited(child))
  ) {
    return { forced: false, exited: true };
  }

  signalChildProcessGroup(child, "SIGTERM");
  const exitedGracefully = await waitForProcessTreeExit(
    child,
    pid,
    options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS,
  );
  if (exitedGracefully) return { forced: false, exited: true };

  signalChildProcessGroup(child, "SIGKILL");
  return {
    forced: true,
    exited: await waitForProcessTreeExit(
      child,
      pid,
      options.forceKillWaitMs ?? DEFAULT_FORCE_KILL_WAIT_MS,
    ),
  };
}

export async function ensureChildProcessGroupTerminated(
  child: ChildProcess,
  options: ChildProcessTerminationOptions = {},
): Promise<void> {
  const result = await terminateChildProcessGroup(child, options);
  if (!result.exited) {
    throw new Error(`Process tree ${child.pid ?? "unknown"} did not exit after forced termination`);
  }
}

export function forceKillChildProcessGroup(child: ChildProcess): void {
  signalChildProcessGroup(child, "SIGKILL");
}
