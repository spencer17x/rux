import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  processGroupExists,
  terminateChildProcessGroup,
} from "../src/electron/child-process-lifecycle.ts";
import { GitChangesService } from "../src/electron/git-service.ts";
import {
  failClosedTimeout,
  runtimeRequestPolicy,
} from "../src/electron/runtime-request-policy.ts";

const stubbornFixture = resolve("tests/fixtures/stubborn-process-tree.mjs");
const slowGitFixture = resolve("tests/fixtures/slow-git-wrapper.mjs");

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for lifecycle fixture");
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

test("long mutating requests use fail-closed Runtime timeout policy", async () => {
  for (const method of [
    "run.start",
    "permission.decide",
    "run.changes.accept",
    "run.changes.restore",
    "git.branch.switch",
    "git.commit",
    "git.push",
  ]) {
    const policy = runtimeRequestPolicy(method);
    assert.equal(policy.timeoutAction, "stop-runtime");
    assert.ok(policy.timeoutMs > 15_000);
  }
  assert.equal(runtimeRequestPolicy("changes.restore").timeoutAction, "stop-runtime");
  assert.equal(runtimeRequestPolicy("git.branches.list").timeoutAction, "reject");
  assert.equal(runtimeRequestPolicy("git.compare").timeoutAction, "reject");
  assert.equal(runtimeRequestPolicy("git.compare").timeoutMs, 60_000);
  assert.deepEqual(runtimeRequestPolicy("agent.model.list"), {
    timeoutMs: 30_000,
    timeoutAction: "reject",
  });
  assert.equal(runtimeRequestPolicy("runtime.ping").timeoutAction, "reject");

  let releaseCleanup;
  const cleanup = new Promise((resolveCleanup) => {
    releaseCleanup = resolveCleanup;
  });
  let rendererObservedFailure = false;
  const timeout = failClosedTimeout("run.start", () => cleanup);
  void timeout.catch(() => {
    rendererObservedFailure = true;
  });
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  assert.equal(rendererObservedFailure, false, "timeout must remain hidden while cleanup is active");
  releaseCleanup();
  await assert.rejects(timeout, /timed out and was stopped: run\.start/);
  assert.equal(rendererObservedFailure, true);
});

test("bounded termination kills a detached provider process group including grandchildren", {
  skip: process.platform === "win32" ? "POSIX process-group assertion" : false,
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-process-tree-"));
  const marker = join(directory, "pids.json");
  const child = spawn(process.execPath, [stubbornFixture], {
    detached: true,
    env: { ...process.env, RUX_PROCESS_TREE_MARKER: marker },
    stdio: "ignore",
  });
  t.after(() => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      // The tested group is already gone.
    }
    rmSync(directory, { recursive: true, force: true });
  });

  await waitUntil(() => existsSync(marker));
  const pids = JSON.parse(readFileSync(marker, "utf8"));
  assert.equal(processGroupExists(child.pid), true);
  const result = await terminateChildProcessGroup(child, {
    gracePeriodMs: 80,
    forceKillWaitMs: 1_000,
  });
  assert.deepEqual(result, { forced: true, exited: true });
  await waitUntil(() => !pidExists(pids.parentPid) && !pidExists(pids.grandchildPid));
});

test("Git shutdown aborts and awaits a slow restore child process tree", {
  skip: process.platform === "win32" ? "POSIX process-group assertion" : false,
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-slow-git-"));
  const workspace = join(directory, "workspace");
  const executable = join(directory, "git");
  const marker = join(directory, "git-pids.json");
  mkdirSync(workspace);
  const trackedFile = join(workspace, "tracked.txt");
  writeFileSync(trackedFile, "before\n", "utf8");
  execFileSync("git", ["-C", workspace, "init", "--quiet"]);
  execFileSync("git", ["-C", workspace, "config", "user.name", "RUX Lifecycle Test"]);
  execFileSync("git", ["-C", workspace, "config", "user.email", "rux-lifecycle@example.invalid"]);
  execFileSync("git", ["-C", workspace, "add", "tracked.txt"]);
  execFileSync("git", ["-C", workspace, "commit", "--quiet", "-m", "fixture"]);
  writeFileSync(trackedFile, "after\n", "utf8");
  const snapshot = await new GitChangesService(workspace).listChanges();
  copyFileSync(slowGitFixture, executable);
  chmodSync(executable, 0o755);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const previousMarker = process.env.RUX_PROCESS_TREE_MARKER;
  const previousRealGit = process.env.RUX_REAL_GIT;
  process.env.RUX_PROCESS_TREE_MARKER = marker;
  process.env.RUX_REAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const service = new GitChangesService(workspace, {
    gitExecutable: executable,
    processTermination: { gracePeriodMs: 80, forceKillWaitMs: 1_000 },
  });
  const restore = service.restore({
    scope: "all",
    expectedSnapshotId: snapshot.snapshotId,
    confirmed: true,
  });
  const restoreOutcome = restore.then(
    () => undefined,
    (error) => error,
  );
  try {
    await waitUntil(() => existsSync(marker));
    const pids = JSON.parse(readFileSync(marker, "utf8"));
    await service.dispose();
    const error = await restoreOutcome;
    assert.match(error?.message ?? "", /Git command failed/);
    await waitUntil(() => !pidExists(pids.parentPid) && !pidExists(pids.grandchildPid));
    assert.equal(readFileSync(trackedFile, "utf8"), "after\n");
  } finally {
    service.forceDispose();
    if (previousMarker === undefined) delete process.env.RUX_PROCESS_TREE_MARKER;
    else process.env.RUX_PROCESS_TREE_MARKER = previousMarker;
    if (previousRealGit === undefined) delete process.env.RUX_REAL_GIT;
    else process.env.RUX_REAL_GIT = previousRealGit;
  }
});
