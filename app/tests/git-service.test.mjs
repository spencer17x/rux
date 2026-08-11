import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitChangesError, GitChangesService } from "../src/electron/git-service.ts";

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  return result.stdout;
}

async function createRepository({ withCommit = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "rux-git-service-"));
  await git(root, "init", "--quiet");
  await git(root, "config", "user.name", "RUX Test");
  await git(root, "config", "user.email", "rux-test@example.invalid");

  if (withCommit) {
    await writeFile(join(root, "tracked.txt"), "one\ntwo\n", "utf8");
    await writeFile(join(root, "staged.txt"), "base\n", "utf8");
    await writeFile(join(root, "deleted.txt"), "gone\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "--quiet", "-m", "initial");
  }

  return root;
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GitChangesError);
    assert.equal(error.code, code);
    return true;
  });
}

test("lists an empty unborn repository without inventing changes", async () => {
  const root = await createRepository();
  try {
    const snapshot = await new GitChangesService(root).listChanges();
    assert.deepEqual(snapshot.files, []);
    assert.deepEqual(snapshot.totals, {
      files: 0,
      additions: 0,
      deletions: 0,
      binaryFiles: 0,
    });
    assert.match(snapshot.snapshotId, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports staged, unstaged, untracked, deleted, and binary changes with real stats", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "one\nchanged\nthree\n", "utf8");
    await writeFile(join(root, "staged.txt"), "base\nstaged\n", "utf8");
    await git(root, "add", "staged.txt");
    await unlink(join(root, "deleted.txt"));
    await writeFile(join(root, "new.txt"), "alpha\nbeta\n", "utf8");
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));

    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();
    const byPath = new Map(snapshot.files.map((change) => [change.path, change]));

    assert.equal(snapshot.totals.files, 5);
    assert.equal(snapshot.totals.additions, 5);
    assert.equal(snapshot.totals.deletions, 2);
    assert.equal(snapshot.totals.binaryFiles, 1);

    assert.equal(byPath.get("tracked.txt")?.kind, "modified");
    assert.equal(byPath.get("tracked.txt")?.staged, false);
    assert.equal(byPath.get("tracked.txt")?.unstaged, true);
    assert.deepEqual(byPath.get("tracked.txt")?.layers.unstaged, {
      additions: 2,
      deletions: 1,
      isBinary: false,
    });

    assert.equal(byPath.get("staged.txt")?.staged, true);
    assert.equal(byPath.get("staged.txt")?.unstaged, false);
    assert.equal(byPath.get("deleted.txt")?.kind, "deleted");
    assert.equal(byPath.get("new.txt")?.untracked, true);
    assert.equal(byPath.get("new.txt")?.additions, 2);
    assert.equal(byPath.get("binary.bin")?.isBinary, true);

    const textDiff = await service.getFileDiff("tracked.txt", snapshot.snapshotId);
    assert.equal(textDiff.sections.length, 1);
    assert.equal(textDiff.sections[0].layer, "unstaged");
    assert.match(textDiff.sections[0].patch, /\+changed/);

    const binaryDiff = await service.getFileDiff("binary.bin", snapshot.snapshotId);
    assert.equal(binaryDiff.isBinary, true);
    assert.equal(binaryDiff.sections[0].patch, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns separate staged and unstaged diff layers for the same file", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "one\nstaged\n", "utf8");
    await git(root, "add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "one\nstaged\nunstaged\n", "utf8");

    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();
    const change = snapshot.files.find((file) => file.path === "tracked.txt");
    assert.equal(change?.staged, true);
    assert.equal(change?.unstaged, true);
    assert.equal(change?.additions, 2);
    assert.equal(change?.deletions, 1);

    const diff = await service.getFileDiff("tracked.txt", snapshot.snapshotId);
    assert.deepEqual(diff.sections.map((section) => section.layer), ["staged", "unstaged"]);
    assert.match(diff.sections[0].patch, /\+staged/);
    assert.match(diff.sections[1].patch, /\+unstaged/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects absolute, traversal, unchanged, and stale-snapshot paths", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "changed\n", "utf8");
    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();

    await rejectsWithCode(service.getFileDiff("../outside.txt"), "INVALID_PATH");
    await rejectsWithCode(service.getFileDiff(join(root, "tracked.txt")), "INVALID_PATH");
    await rejectsWithCode(service.getFileDiff("staged.txt"), "NOT_CHANGED");
    await rejectsWithCode(service.restore({
      scope: "file",
      path: "../outside.txt",
      expectedSnapshotId: snapshot.snapshotId,
      confirmed: true,
    }), "INVALID_PATH");

    await writeFile(join(root, "tracked.txt"), "changed again\n", "utf8");
    await rejectsWithCode(service.previewRestore({
      scope: "file",
      path: "tracked.txt",
      expectedSnapshotId: snapshot.snapshotId,
    }), "STALE_SNAPSHOT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restores a staged rename in the worktree without changing the staged index", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await git(root, "mv", "tracked.txt", "renamed.txt");
    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();
    const renamed = snapshot.files.find((file) => file.path === "renamed.txt");
    assert.equal(renamed?.kind, "renamed");
    assert.equal(renamed?.originalPath, "tracked.txt");
    const indexBeforeRestore = await readFile(join(root, ".git", "index"));
    const stagedBeforeRestore = await git(root, "diff", "--cached", "--binary");

    const result = await service.restore({
      scope: "file",
      path: "renamed.txt",
      expectedSnapshotId: snapshot.snapshotId,
      confirmed: true,
    });
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
    await assert.rejects(readFile(join(root, "renamed.txt"), "utf8"), { code: "ENOENT" });
    assert.ok(result.remaining.files.some((file) => file.staged));
    assert.deepEqual(await readFile(join(root, ".git", "index")), indexBeforeRestore);
    assert.equal(await git(root, "diff", "--cached", "--binary"), stagedBeforeRestore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scopes status and restore to an authorized repository subdirectory", async () => {
  const root = await createRepository();
  const workspace = join(root, "workspace");
  try {
    await mkdir(workspace);
    await writeFile(join(workspace, "inside.txt"), "inside\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "--quiet", "-m", "subdirectory fixture");

    await writeFile(join(workspace, "inside.txt"), "inside changed\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside changed\n", "utf8");
    const service = new GitChangesService(workspace);
    const snapshot = await service.listChanges();
    assert.deepEqual(snapshot.files.map((file) => file.path), ["inside.txt"]);

    const result = await service.restore({
      scope: "all",
      expectedSnapshotId: snapshot.snapshotId,
      confirmed: true,
    });
    assert.equal(result.remaining.files.length, 0);
    assert.equal(await readFile(join(workspace, "inside.txt"), "utf8"), "inside\n");
    assert.equal(await readFile(join(root, "outside.txt"), "utf8"), "outside changed\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restores one tracked file without discarding unrelated changes", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "changed tracked\n", "utf8");
    await writeFile(join(root, "staged.txt"), "changed staged\n", "utf8");
    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();
    const selection = {
      scope: "file",
      path: "tracked.txt",
      expectedSnapshotId: snapshot.snapshotId,
    };

    await rejectsWithCode(service.restore({ ...selection, confirmed: false }), "CONFIRMATION_REQUIRED");
    const preview = await service.previewRestore(selection);
    assert.deepEqual(preview.restoreFromHeadPaths, ["tracked.txt"]);
    assert.deepEqual(preview.deletePaths, []);

    const result = await service.restore({ ...selection, confirmed: true });
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
    assert.equal(await readFile(join(root, "staged.txt"), "utf8"), "changed staged\n");
    assert.deepEqual(result.restoredPaths, ["tracked.txt"]);
    assert.deepEqual(result.remaining.files.map((file) => file.path), ["staged.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restores all worktree changes, reports deleted new files, and preserves staged bytes", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "modified\n", "utf8");
    await writeFile(join(root, "staged.txt"), "modified and staged\n", "utf8");
    await git(root, "add", "staged.txt");
    await unlink(join(root, "deleted.txt"));
    await writeFile(join(root, "new.txt"), "new data\n", "utf8");

    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();
    const selection = { scope: "all", expectedSnapshotId: snapshot.snapshotId };
    const preview = await service.previewRestore(selection);
    assert.deepEqual(preview.deletePaths, ["new.txt"]);
    assert.match(preview.warning, /permanently deletes/);
    const indexBeforeRestore = await readFile(join(root, ".git", "index"));
    const stagedBeforeRestore = await git(root, "diff", "--cached", "--binary");

    const result = await service.restore({ ...selection, confirmed: true });
    assert.deepEqual(result.deletedPaths, ["new.txt"]);
    assert.deepEqual(result.remaining.files.map((file) => file.path), ["staged.txt"]);
    assert.equal(await readFile(join(root, "deleted.txt"), "utf8"), "gone\n");
    await assert.rejects(readFile(join(root, "new.txt"), "utf8"), { code: "ENOENT" });
    assert.deepEqual(await readFile(join(root, ".git", "index")), indexBeforeRestore);
    assert.equal(await git(root, "diff", "--cached", "--binary"), stagedBeforeRestore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records review acceptance without changing the Git index or worktree", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "review me\n", "utf8");
    await writeFile(join(root, "new.txt"), "also review me\n", "utf8");
    const service = new GitChangesService(root);
    const snapshot = await service.listChanges();
    const before = await git(root, "status", "--porcelain=v2");

    const acceptance = await service.recordReviewAcceptance({
      scope: "all",
      expectedSnapshotId: snapshot.snapshotId,
    });

    assert.equal(acceptance.semantics, "review-only");
    assert.equal(acceptance.snapshotId, snapshot.snapshotId);
    assert.deepEqual(acceptance.paths, ["new.txt", "tracked.txt"]);
    assert.match(acceptance.id, /^[a-f0-9-]{36}$/);
    assert.equal(await git(root, "status", "--porcelain=v2"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attributes only changes made after a Run baseline without touching the real index", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, ".git", "info", "exclude"), "ignored.log\n", "utf8");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nuser before run\n", "utf8");
    await writeFile(join(root, "staged.txt"), "base\nuser staged before run\n", "utf8");
    await git(root, "add", "staged.txt");
    await writeFile(join(root, "user-before.txt"), "pre-existing untracked\n", "utf8");
    await writeFile(join(root, "ignored.log"), "ignored before\n", "utf8");

    const service = new GitChangesService(root);
    const statusBeforeBaseline = await git(root, "status", "--porcelain=v2");
    const stagedBeforeBaseline = await git(root, "diff", "--cached", "--binary");
    const baseline = await service.captureRunBaseline("run-owned");

    assert.match(baseline.treeId, /^[a-f0-9]{40,64}$/);
    assert.equal(baseline.ignoredFilesExcluded, true);
    assert.equal(await git(root, "status", "--porcelain=v2"), statusBeforeBaseline);
    assert.equal(await git(root, "diff", "--cached", "--binary"), stagedBeforeBaseline);

    await writeFile(join(root, "tracked.txt"), "one\ntwo\nuser before run\nagent delta\n", "utf8");
    await writeFile(join(root, "agent-new.txt"), "agent one\nagent two\n", "utf8");
    await writeFile(join(root, "ignored.log"), "ignored after\n", "utf8");
    const statusBeforeCompare = await git(root, "status", "--porcelain=v2");
    const patch = await service.compareRunChanges(baseline);

    assert.equal(patch.runId, "run-owned");
    assert.equal(patch.baselineId, baseline.id);
    assert.equal(patch.beforeTreeId, baseline.treeId);
    assert.deepEqual(patch.files.map((file) => file.path), ["agent-new.txt", "tracked.txt"]);
    assert.deepEqual(patch.files.map((file) => file.kind), ["added", "modified"]);
    assert.equal(patch.files.find((file) => file.path === "agent-new.txt")?.additions, 2);
    assert.equal(patch.files.find((file) => file.path === "tracked.txt")?.additions, 1);
    assert.equal(patch.totals.files, 2);
    assert.equal(patch.totals.additions, 3);
    assert.equal(patch.totals.deletions, 0);
    assert.equal(patch.files.some((file) => file.path === "user-before.txt"), false);
    assert.equal(patch.files.some((file) => file.path === "staged.txt"), false);
    assert.equal(patch.files.some((file) => file.path === "ignored.log"), false);
    assert.equal(await git(root, "status", "--porcelain=v2"), statusBeforeCompare);
    assert.equal(await git(root, "diff", "--cached", "--binary"), stagedBeforeBaseline);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads and accepts only the immutable Run patch when staged, unstaged, and later edits share its path", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nuser staged\n", "utf8");
    await git(root, "add", "tracked.txt");
    await writeFile(
      join(root, "tracked.txt"),
      "one\ntwo\nuser staged\nuser unstaged\n",
      "utf8",
    );
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));

    const service = new GitChangesService(root);
    const baseline = await service.captureRunBaseline("review-owned-run");
    await writeFile(
      join(root, "tracked.txt"),
      "one\ntwo\nuser staged\nuser unstaged\nagent delta\n",
      "utf8",
    );
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    const patch = await service.compareRunChanges(baseline);

    assert.deepEqual(patch.files.map((file) => file.path), ["binary.bin", "tracked.txt"]);
    assert.equal(patch.files.find((file) => file.path === "tracked.txt")?.additions, 1);
    assert.equal(patch.files.find((file) => file.path === "binary.bin")?.isBinary, true);

    await writeFile(
      join(root, "tracked.txt"),
      "one\ntwo\nuser staged\nuser unstaged\nagent delta\npost-run drift\n",
      "utf8",
    );
    const statusBeforeReview = await git(root, "status", "--porcelain=v2");
    const stagedBeforeReview = await git(root, "diff", "--cached", "--binary");
    const indexBeforeReview = await readFile(join(root, ".git", "index"));
    const worktreeBeforeReview = await readFile(join(root, "tracked.txt"));
    const selection = { baseline, patch, expectedSnapshotId: patch.snapshotId };

    const textDiff = await service.getRunFileDiff({ ...selection, path: "tracked.txt" });
    assert.equal(textDiff.runId, "review-owned-run");
    assert.equal(textDiff.snapshotId, patch.snapshotId);
    assert.equal(textDiff.runPatchSnapshotId, patch.snapshotId);
    assert.equal(textDiff.beforeTreeId, baseline.treeId);
    assert.equal(textDiff.afterTreeId, patch.afterTreeId);
    assert.equal(textDiff.additions, 1);
    assert.equal(textDiff.deletions, 0);
    assert.equal(textDiff.isBinary, false);
    assert.match(textDiff.patch, /^\+agent delta$/m);
    assert.doesNotMatch(textDiff.patch, /^\+user staged$/m);
    assert.doesNotMatch(textDiff.patch, /^\+user unstaged$/m);
    assert.doesNotMatch(textDiff.patch, /post-run drift/);

    const binaryDiff = await service.getRunFileDiff({ ...selection, path: "binary.bin" });
    assert.equal(binaryDiff.isBinary, true);
    assert.equal(binaryDiff.patch, null);

    const acceptance = await service.recordRunReviewAcceptance({
      ...selection,
      paths: ["tracked.txt"],
    });
    assert.equal(acceptance.semantics, "review-only");
    assert.equal(acceptance.runId, "review-owned-run");
    assert.equal(acceptance.snapshotId, patch.snapshotId);
    assert.equal(acceptance.runPatchSnapshotId, patch.snapshotId);
    assert.equal(acceptance.scope, "file");
    assert.deepEqual(acceptance.paths, ["tracked.txt"]);
    assert.equal(acceptance.additions, 1);
    assert.equal(acceptance.deletions, 0);

    await rejectsWithCode(
      service.getRunFileDiff({ ...selection, path: "staged.txt" }),
      "NOT_CHANGED",
    );
    await rejectsWithCode(
      service.recordRunReviewAcceptance({ ...selection, expectedSnapshotId: "0".repeat(64) }),
      "STALE_RUN_PATCH",
    );
    assert.deepEqual(await readFile(join(root, ".git", "index")), indexBeforeReview);
    assert.deepEqual(await readFile(join(root, "tracked.txt")), worktreeBeforeReview);
    assert.equal(await git(root, "diff", "--cached", "--binary"), stagedBeforeReview);
    assert.equal(await git(root, "status", "--porcelain=v2"), statusBeforeReview);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scopes Run-owned attribution to an authorized repository subdirectory", async () => {
  const root = await createRepository();
  const workspace = join(root, "workspace");
  try {
    await mkdir(workspace);
    await writeFile(join(workspace, "inside.txt"), "inside\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "--quiet", "-m", "subdirectory baseline fixture");

    const service = new GitChangesService(workspace);
    const baseline = await service.captureRunBaseline("sub-workspace-run");
    await writeFile(join(workspace, "inside.txt"), "inside\nagent inside\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside\nuser outside\n", "utf8");
    await writeFile(join(root, "outside-new.txt"), "outside only\n", "utf8");
    const patch = await service.compareRunChanges(baseline);

    assert.equal(patch.workspaceRoot, service.workspaceRoot);
    assert.deepEqual(patch.files.map((file) => file.path), ["inside.txt"]);
    assert.equal(patch.totals.additions, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restores Run-owned add, modify, and delete while preserving every pre-Run change layer", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await writeFile(join(root, ".git", "info", "exclude"), "ignored.log\n", "utf8");
    await writeFile(join(root, "staged.txt"), "base\nuser staged before run\n", "utf8");
    await git(root, "add", "staged.txt");
    await writeFile(join(root, "tracked.txt"), "one\ntwo\nuser unstaged before run\n", "utf8");
    await writeFile(join(root, "user-before.txt"), "user untracked before run\n", "utf8");
    await writeFile(join(root, "ignored.log"), "ignored before run\n", "utf8");

    const service = new GitChangesService(root);
    const statusBeforeRun = await git(root, "status", "--porcelain=v2");
    const stagedBeforeRun = await git(root, "diff", "--cached", "--binary");
    const indexBeforeRun = await readFile(join(root, ".git", "index"));
    const baseline = await service.captureRunBaseline("restore-owned-run");

    await writeFile(
      join(root, "tracked.txt"),
      "one\ntwo\nuser unstaged before run\nagent appended\n",
      "utf8",
    );
    await writeFile(
      join(root, "user-before.txt"),
      "user untracked before run\nagent touched it\n",
      "utf8",
    );
    await unlink(join(root, "deleted.txt"));
    await writeFile(join(root, "agent-new.txt"), "created by agent\n", "utf8");
    await writeFile(join(root, "ignored.log"), "ignored after run\n", "utf8");
    const patch = await service.compareRunChanges(baseline);

    assert.deepEqual(patch.files.map((file) => file.path), [
      "agent-new.txt",
      "deleted.txt",
      "tracked.txt",
      "user-before.txt",
    ]);
    assert.equal(patch.beforeIndexSnapshotId, patch.afterIndexSnapshotId);
    const selection = {
      baseline,
      patch,
      expectedSnapshotId: patch.snapshotId,
    };
    const preview = await service.previewRunRestore(selection);
    assert.deepEqual(preview.conflicts, []);
    assert.deepEqual(preview.restorePaths, ["deleted.txt", "tracked.txt", "user-before.txt"]);
    assert.deepEqual(preview.deletePaths, ["agent-new.txt"]);
    assert.match(preview.warning, /created by this Run/);

    await rejectsWithCode(
      service.restoreRunChanges({ ...selection, confirmed: false }),
      "CONFIRMATION_REQUIRED",
    );
    const result = await service.restoreRunChanges({ ...selection, confirmed: true });

    assert.deepEqual(result.restoredPaths, preview.selectedPaths);
    assert.deepEqual(result.deletedPaths, ["agent-new.txt"]);
    assert.deepEqual(result.unresolvedPaths, []);
    assert.equal(result.afterTreeId, baseline.treeId);
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\nuser unstaged before run\n");
    assert.equal(await readFile(join(root, "user-before.txt"), "utf8"), "user untracked before run\n");
    assert.equal(await readFile(join(root, "deleted.txt"), "utf8"), "gone\n");
    assert.equal(await readFile(join(root, "ignored.log"), "utf8"), "ignored after run\n");
    await assert.rejects(readFile(join(root, "agent-new.txt"), "utf8"), { code: "ENOENT" });
    assert.deepEqual(await readFile(join(root, ".git", "index")), indexBeforeRun);
    assert.equal(await git(root, "status", "--porcelain=v2"), statusBeforeRun);
    assert.equal(await git(root, "diff", "--cached", "--binary"), stagedBeforeRun);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects stale Run snapshots, unsafe selections, and same-path edits made after the Run", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    const service = new GitChangesService(root);
    const baseline = await service.captureRunBaseline("stale-run");
    await writeFile(join(root, "tracked.txt"), "agent version\n", "utf8");
    const patch = await service.compareRunChanges(baseline);
    const selection = { baseline, patch, expectedSnapshotId: patch.snapshotId };

    await rejectsWithCode(
      service.previewRunRestore({ ...selection, expectedSnapshotId: "0".repeat(64) }),
      "STALE_RUN_PATCH",
    );
    await rejectsWithCode(
      service.previewRunRestore({ ...selection, paths: ["../outside.txt"] }),
      "INVALID_PATH",
    );
    const tamperedPatch = {
      ...patch,
      files: patch.files.map((file, index) => index === 0 ? { ...file, path: "other.txt" } : file),
    };
    await rejectsWithCode(
      service.previewRunRestore({ ...selection, patch: tamperedPatch }),
      "STALE_RUN_PATCH",
    );

    await writeFile(join(root, "tracked.txt"), "agent version\nuser concurrent edit\n", "utf8");
    const preview = await service.previewRunRestore(selection);
    assert.deepEqual(preview.conflicts.map((conflict) => conflict.reason), [
      "WORKTREE_CHANGED_AFTER_RUN",
    ]);
    await rejectsWithCode(
      service.restoreRunChanges({ ...selection, confirmed: true }),
      "RUN_RESTORE_STALE_WORKTREE",
    );
    assert.equal(
      await readFile(join(root, "tracked.txt"), "utf8"),
      "agent version\nuser concurrent edit\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves unrelated worktree drift while restoring selected Run-owned paths", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    const service = new GitChangesService(root);
    const baseline = await service.captureRunBaseline("unrelated-drift-run");
    await writeFile(join(root, "tracked.txt"), "agent changed tracked\n", "utf8");
    await unlink(join(root, "deleted.txt"));
    const patch = await service.compareRunChanges(baseline);

    await writeFile(join(root, "staged.txt"), "user changed after run\n", "utf8");
    const selection = {
      baseline,
      patch,
      expectedSnapshotId: patch.snapshotId,
      paths: ["tracked.txt"],
    };
    const preview = await service.previewRunRestore(selection);
    assert.deepEqual(preview.conflicts, []);
    assert.deepEqual(preview.selectedPaths, ["tracked.txt"]);
    assert.match(preview.warning, /unrelated post-Run change/);

    const result = await service.restoreRunChanges({ ...selection, confirmed: true });
    assert.deepEqual(result.unresolvedPaths, []);
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "one\ntwo\n");
    assert.equal(await readFile(join(root, "staged.txt"), "utf8"), "user changed after run\n");
    await assert.rejects(readFile(join(root, "deleted.txt"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses Run-owned restore when the real index changed during or after the Run", async () => {
  const duringRoot = await createRepository({ withCommit: true });
  const afterRoot = await createRepository({ withCommit: true });
  try {
    const duringService = new GitChangesService(duringRoot);
    const duringBaseline = await duringService.captureRunBaseline("index-during-run");
    await writeFile(join(duringRoot, "agent-new.txt"), "agent staged this\n", "utf8");
    await git(duringRoot, "add", "agent-new.txt");
    const duringPatch = await duringService.compareRunChanges(duringBaseline);
    const duringSelection = {
      baseline: duringBaseline,
      patch: duringPatch,
      expectedSnapshotId: duringPatch.snapshotId,
    };
    const duringPreview = await duringService.previewRunRestore(duringSelection);
    assert.ok(duringPreview.conflicts.some((conflict) => conflict.reason === "INDEX_CHANGED_DURING_RUN"));
    await rejectsWithCode(
      duringService.restoreRunChanges({ ...duringSelection, confirmed: true }),
      "RUN_RESTORE_INDEX_DRIFT",
    );
    assert.equal(await readFile(join(duringRoot, "agent-new.txt"), "utf8"), "agent staged this\n");

    const afterService = new GitChangesService(afterRoot);
    const afterBaseline = await afterService.captureRunBaseline("index-after-run");
    await writeFile(join(afterRoot, "tracked.txt"), "agent worktree edit\n", "utf8");
    const afterPatch = await afterService.compareRunChanges(afterBaseline);
    await writeFile(join(afterRoot, "staged.txt"), "user staged after run\n", "utf8");
    await git(afterRoot, "add", "staged.txt");
    const afterSelection = {
      baseline: afterBaseline,
      patch: afterPatch,
      expectedSnapshotId: afterPatch.snapshotId,
    };
    const afterPreview = await afterService.previewRunRestore(afterSelection);
    assert.ok(afterPreview.conflicts.some((conflict) => conflict.reason === "INDEX_CHANGED_AFTER_RUN"));
    await rejectsWithCode(
      afterService.restoreRunChanges({ ...afterSelection, confirmed: true }),
      "RUN_RESTORE_INDEX_DRIFT",
    );
    assert.equal(await readFile(join(afterRoot, "tracked.txt"), "utf8"), "agent worktree edit\n");
  } finally {
    await rm(duringRoot, { recursive: true, force: true });
    await rm(afterRoot, { recursive: true, force: true });
  }
});

test("restores only the authorized sub-workspace and leaves repository siblings untouched", async () => {
  const root = await createRepository();
  const workspace = join(root, "workspace");
  try {
    await mkdir(workspace);
    await writeFile(join(workspace, "inside.txt"), "inside baseline\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside baseline\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "--quiet", "-m", "sub-workspace restore fixture");

    const service = new GitChangesService(workspace);
    const baseline = await service.captureRunBaseline("sub-workspace-restore");
    await writeFile(join(workspace, "inside.txt"), "inside agent\n", "utf8");
    await writeFile(join(workspace, "inside-new.txt"), "inside agent new\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside changed concurrently\n", "utf8");
    const patch = await service.compareRunChanges(baseline);
    assert.deepEqual(patch.files.map((file) => file.path), ["inside-new.txt", "inside.txt"]);

    const result = await service.restoreRunChanges({
      baseline,
      patch,
      expectedSnapshotId: patch.snapshotId,
      confirmed: true,
    });
    assert.deepEqual(result.unresolvedPaths, []);
    assert.equal(await readFile(join(workspace, "inside.txt"), "utf8"), "inside baseline\n");
    await assert.rejects(readFile(join(workspace, "inside-new.txt"), "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "outside.txt"), "utf8"), "outside changed concurrently\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes an Agent-created symlink without following it outside the workspace", async () => {
  const root = await createRepository({ withCommit: true });
  const outsideRoot = await mkdtemp(join(tmpdir(), "rux-git-outside-"));
  try {
    const sentinel = join(outsideRoot, "sentinel.txt");
    await writeFile(sentinel, "must survive\n", "utf8");
    const service = new GitChangesService(root);
    const baseline = await service.captureRunBaseline("safe-symlink-run");
    await symlink(sentinel, join(root, "agent-link"));
    const patch = await service.compareRunChanges(baseline);

    const result = await service.restoreRunChanges({
      baseline,
      patch,
      expectedSnapshotId: patch.snapshotId,
      confirmed: true,
    });
    assert.deepEqual(result.deletedPaths, ["agent-link"]);
    await assert.rejects(readFile(join(root, "agent-link"), "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(sentinel, "utf8"), "must survive\n");

    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "victim.txt"), "tracked\n", "utf8");
    await git(root, "add", "nested/victim.txt");
    await git(root, "commit", "--quiet", "-m", "symlink parent fixture");
    const parentBaseline = await service.captureRunBaseline("unsafe-parent-run");
    await writeFile(join(root, "nested", "victim.txt"), "agent changed\n", "utf8");
    const parentPatch = await service.compareRunChanges(parentBaseline);
    await rename(join(root, "nested"), join(root, "nested-away"));
    await symlink(outsideRoot, join(root, "nested"));
    await rejectsWithCode(
      service.previewRunRestore({
        baseline: parentBaseline,
        patch: parentPatch,
        expectedSnapshotId: parentPatch.snapshotId,
      }),
      "INVALID_PATH",
    );
    assert.equal(await readFile(sentinel, "utf8"), "must survive\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("lists local and remote branches, switches only existing local branches, and compares merge-base to HEAD", async () => {
  const root = await createRepository({ withCommit: true });
  const remoteRoot = await mkdtemp(join(tmpdir(), "rux-git-remote-"));
  const bareRemote = join(remoteRoot, "origin.git");
  try {
    await git(root, "branch", "-M", "main");
    await execFileAsync("git", ["init", "--bare", "--quiet", bareRemote]);
    await git(root, "remote", "add", "origin", bareRemote);
    await git(root, "push", "--quiet", "-u", "origin", "main");
    await git(root, "switch", "--quiet", "-c", "feature");
    await writeFile(join(root, "tracked.txt"), "one\nfeature\nthree\n", "utf8");
    await git(root, "add", "tracked.txt");
    await git(root, "commit", "--quiet", "-m", "feature change");

    const service = new GitChangesService(root);
    const branches = await service.listBranches();
    assert.equal(branches.currentBranch, "feature");
    assert.equal(branches.detached, false);
    assert.match(branches.headId, /^[a-f0-9]{40,64}$/);
    assert.deepEqual(branches.local.map((branch) => branch.name), ["feature", "main"]);
    assert.equal(branches.remote.some((branch) => branch.name === "origin/main"), true);
    assert.equal(branches.comparable.some((branch) => branch.name === "main" && branch.kind === "local"), true);
    assert.equal(branches.comparable.some((branch) => branch.name === "origin/main" && branch.kind === "remote"), true);

    const comparison = await service.compareBranch({ base: "main" });
    assert.deepEqual(comparison.files.map((file) => file.path), ["tracked.txt"]);
    assert.equal(comparison.totals.files, 1);
    assert.equal(comparison.totals.additions > 0, true);
    assert.match(comparison.patch, /\+feature/);
    assert.match(comparison.summary, /1 files changed/);
    assert.equal(comparison.truncated, false);

    const switched = await service.switchBranch({ branch: "main" });
    assert.equal(switched.currentBranch, "main");
    await rejectsWithCode(service.switchBranch({ branch: "origin/main" }), "BRANCH_NOT_FOUND");
    await rejectsWithCode(service.switchBranch({ branch: "missing" }), "BRANCH_NOT_FOUND");

    await writeFile(join(root, "tracked.txt"), "local main edit\n", "utf8");
    await rejectsWithCode(service.switchBranch({ branch: "feature" }), "BRANCH_SWITCH_FAILED");
    assert.equal((await git(root, "branch", "--show-current")).trim(), "main");
    await rejectsWithCode(service.compareBranch({ base: "missing" }), "COMPARE_BASE_NOT_FOUND");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(remoteRoot, { recursive: true, force: true });
  }
});

test("commits only existing staged content and preserves unstaged and untracked work", async () => {
  const root = await createRepository({ withCommit: true });
  try {
    await git(root, "branch", "-M", "main");
    await writeFile(join(root, "staged.txt"), "base\nstaged commit\n", "utf8");
    await git(root, "add", "staged.txt");
    await writeFile(join(root, "tracked.txt"), "unstaged work\n", "utf8");
    await writeFile(join(root, "untracked.txt"), "untracked work\n", "utf8");
    await git(root, "config", "commit.gpgSign", "true");

    const service = new GitChangesService(root);
    await rejectsWithCode(service.commitStaged({ message: "   " }), "INVALID_COMMIT_MESSAGE");
    const committed = await service.commitStaged({ message: "  staged only  " });
    assert.equal(committed.branch, "main");
    assert.equal(committed.message, "staged only");
    assert.equal(committed.files, 1);
    assert.match(committed.commitId, /^[a-f0-9]{40,64}$/);
    assert.deepEqual(
      (await git(root, "show", "--pretty=format:", "--name-only", "HEAD")).trim().split(/\r?\n/).filter(Boolean),
      ["staged.txt"],
    );
    const status = await git(root, "status", "--porcelain");
    assert.match(status, / M tracked\.txt/);
    assert.match(status, /\?\? untracked\.txt/);
    await rejectsWithCode(service.commitStaged({ message: "nothing staged" }), "NO_STAGED_CHANGES");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pushes only the current branch to its configured upstream after explicit confirmation", async () => {
  const root = await createRepository({ withCommit: true });
  const remoteRoot = await mkdtemp(join(tmpdir(), "rux-git-push-remote-"));
  const bareRemote = join(remoteRoot, "origin.git");
  const pushEnvironmentLog = join(root, "push-environment.json");
  try {
    await git(root, "branch", "-M", "main");
    await execFileAsync("git", ["init", "--bare", "--quiet", bareRemote]);
    await git(root, "remote", "add", "origin", bareRemote);
    await git(root, "push", "--quiet", "-u", "origin", "main");
    await git(root, "branch", "local-only");
    await writeFile(join(root, "staged.txt"), "base\nnext\n", "utf8");
    await git(root, "add", "staged.txt");

    const service = new GitChangesService(root);
    const commit = await service.commitStaged({ message: "next" });
    await git(root, "tag", "-a", "local-tag", "-m", "must not follow tag");
    await git(root, "config", "remote.origin.mirror", "true");
    await git(root, "config", "push.followTags", "true");
    const prePush = join(root, ".git", "hooks", "pre-push");
    await writeFile(prePush, `#!/usr/bin/env node
const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pushEnvironmentLog)},JSON.stringify({
  terminalPrompt:process.env.GIT_TERMINAL_PROMPT,
  askpass:process.env.GIT_ASKPASS,
  credentialManagerInteractive:process.env.GCM_INTERACTIVE,
  sshAskpass:process.env.SSH_ASKPASS,
  sshAskpassRequire:process.env.SSH_ASKPASS_REQUIRE,
  configCount:process.env.GIT_CONFIG_COUNT,
}));
`, "utf8");
    await chmod(prePush, 0o755);
    await rejectsWithCode(service.pushCurrent({ confirmed: false }), "CONFIRMATION_REQUIRED");
    const pushed = await service.pushCurrent({ confirmed: true });
    assert.deepEqual(pushed, {
      branch: "main",
      upstream: "origin/main",
      commitId: commit.commitId,
      pushed: true,
    });
    assert.equal((await git(bareRemote, "rev-parse", "refs/heads/main")).trim(), commit.commitId);
    await assert.rejects(git(bareRemote, "rev-parse", "refs/heads/local-only"));
    await assert.rejects(git(bareRemote, "rev-parse", "refs/tags/local-tag"));
    assert.deepEqual(JSON.parse(await readFile(pushEnvironmentLog, "utf8")), {
      terminalPrompt: "0",
      askpass: "",
      credentialManagerInteractive: "Never",
      sshAskpass: "",
      sshAskpassRequire: "never",
      configCount: "2",
    });

    await git(root, "switch", "--quiet", "-c", "no-upstream");
    await rejectsWithCode(service.pushCurrent({ confirmed: true }), "NO_UPSTREAM");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(remoteRoot, { recursive: true, force: true });
  }
});

test("rejects repo-wide mutations from an authorized sub-workspace and scopes compare output", async () => {
  const root = await createRepository();
  const workspace = join(root, "workspace");
  try {
    await mkdir(workspace);
    await writeFile(join(workspace, "inside.txt"), "inside base\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside base\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "--quiet", "-m", "base");
    await git(root, "branch", "-M", "main");
    await git(root, "switch", "--quiet", "-c", "feature");
    await writeFile(join(workspace, "inside.txt"), "inside feature\n", "utf8");
    await writeFile(join(root, "outside.txt"), "outside feature\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "--quiet", "-m", "feature");

    const service = new GitChangesService(workspace);
    const comparison = await service.compareBranch({ base: "main" });
    assert.deepEqual(comparison.files.map((file) => file.path), ["inside.txt"]);
    assert.match(comparison.patch, /inside feature/);
    assert.doesNotMatch(comparison.patch, /outside feature/);
    await rejectsWithCode(service.switchBranch({ branch: "main" }), "REPOSITORY_ROOT_REQUIRED");
    await rejectsWithCode(service.commitStaged({ message: "must refuse" }), "REPOSITORY_ROOT_REQUIRED");
    await rejectsWithCode(service.pushCurrent({ confirmed: true }), "REPOSITORY_ROOT_REQUIRED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes repo-wide mutations across checkout and commit hooks", {
  skip: process.platform === "win32" ? "POSIX executable Git hooks are required" : false,
}, async () => {
  const root = await createRepository({ withCommit: true });
  const hookLog = join(root, "hook-order.log");
  try {
    await git(root, "branch", "-M", "main");
    await git(root, "branch", "feature");
    const hooksRoot = join(root, ".git", "hooks");
    const postCheckout = join(hooksRoot, "post-checkout");
    const preCommit = join(hooksRoot, "pre-commit");
    await writeFile(postCheckout, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(hookLog)},'checkout-start\\n');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(hookLog)},'checkout-end\\n');},250);\n`, "utf8");
    await writeFile(preCommit, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(hookLog)},'commit\\n');\n`, "utf8");
    await chmod(postCheckout, 0o755);
    await chmod(preCommit, 0o755);
    await writeFile(join(root, "queued.txt"), "queued\n", "utf8");
    await git(root, "add", "queued.txt");

    const service = new GitChangesService(root);
    const [switched, committed] = await Promise.all([
      service.switchBranch({ branch: "feature" }),
      service.commitStaged({ message: "queued commit" }),
    ]);
    assert.equal(switched.currentBranch, "feature");
    assert.equal(committed.branch, "feature");
    assert.deepEqual((await readFile(hookLog, "utf8")).trim().split(/\r?\n/), [
      "checkout-start",
      "checkout-end",
      "commit",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
