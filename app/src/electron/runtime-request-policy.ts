import type { RuntimeMethod } from "../shared/protocol.ts";

export type RuntimeRequestTimeoutAction = "reject" | "stop-runtime";

export type RuntimeRequestPolicy = {
  timeoutMs: number;
  timeoutAction: RuntimeRequestTimeoutAction;
};

const MUTATING_METHODS = new Set<RuntimeMethod>([
  "runtime.shutdown",
  "auth.login",
  "auth.cancel",
  "terminal.create",
  "terminal.write",
  "terminal.resize",
  "terminal.dispose",
  "agent.profile.create",
  "agent.profile.update",
  "agent.profile.delete",
  "run.start",
  "run.cancel",
  "permission.decide",
  "run.changes.accept",
  "run.changes.restore",
  "changes.restore",
  "changes.accept",
  "git.branch.switch",
  "git.commit",
  "git.push",
  "task.state.save",
]);

export function runtimeRequestPolicy(method: RuntimeMethod): RuntimeRequestPolicy {
  const timeoutMs = method === "auth.login"
    ? 10 * 60_000 + 5_000
    : ["run.start", "permission.decide", "run.changes.restore", "git.branch.switch", "git.commit", "git.push"].includes(method)
      ? 3 * 60_000
      : method.startsWith("changes.")
          || method === "git.branches.list"
          || method === "git.compare"
          || ["run.changes.diff", "run.changes.accept", "run.changes.previewRestore"].includes(method)
        ? 60_000
        : method === "auth.status" || method === "agent.model.list"
          ? 30_000
          : 15_000;
  return {
    timeoutMs,
    timeoutAction: MUTATING_METHODS.has(method) ? "stop-runtime" : "reject",
  };
}

/** A mutating timeout is not observable until Runtime cleanup has completed. */
export async function failClosedTimeout(
  method: RuntimeMethod,
  cleanup: () => Promise<void>,
): Promise<never> {
  await cleanup();
  throw new Error(`Rux Runtime request timed out and was stopped: ${method}`);
}
