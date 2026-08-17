import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
  unlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type ChildProcessTerminationOptions,
  awaitAllCleanup,
  ensureChildProcessGroupTerminated,
  forceKillChildProcessGroup,
} from "./child-process-lifecycle.ts";

const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_FILE_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_COMPARE_PATCH_BYTES = 1024 * 1024;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

export type GitChangesErrorCode =
  | "NOT_REPOSITORY"
  | "INVALID_PATH"
  | "NOT_CHANGED"
  | "STALE_SNAPSHOT"
  | "STALE_RUN_PATCH"
  | "RUN_RESTORE_CONFLICT"
  | "RUN_RESTORE_STALE_WORKTREE"
  | "RUN_RESTORE_INDEX_DRIFT"
  | "CONFIRMATION_REQUIRED"
  | "UNSUPPORTED_DIRECTORY"
  | "REPOSITORY_ROOT_REQUIRED"
  | "BRANCH_NOT_FOUND"
  | "BRANCH_SWITCH_FAILED"
  | "WORKTREE_TARGET_EXISTS"
  | "WORKTREE_BRANCH_IN_USE"
  | "WORKTREE_CREATE_FAILED"
  | "DETACHED_HEAD"
  | "NO_STAGED_CHANGES"
  | "INVALID_COMMIT_MESSAGE"
  | "COMMIT_FAILED"
  | "NO_UPSTREAM"
  | "PUSH_FAILED"
  | "COMPARE_BASE_NOT_FOUND"
  | "COMPARE_FAILED"
  | "GIT_FAILED";

export class GitChangesError extends Error {
  readonly code: GitChangesErrorCode;

  constructor(
    code: GitChangesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitChangesError";
    this.code = code;
  }
}

export type GitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export type GitDiffLayer = "staged" | "unstaged" | "untracked";

export type GitDiffStat = {
  additions: number;
  deletions: number;
  isBinary: boolean;
};

export type GitFileChange = {
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /** Sum of additions/deletions across the staged, unstaged, and untracked layers. */
  additions: number;
  deletions: number;
  isBinary: boolean;
  layers: Partial<Record<GitDiffLayer, GitDiffStat>>;
};

export type GitChangesSnapshot = {
  workspaceRoot: string;
  snapshotId: string;
  files: GitFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
};

export type GitDiffSection = GitDiffStat & {
  layer: GitDiffLayer;
  patch: string | null;
};

export type GitFileDiff = {
  snapshotId: string;
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  isBinary: boolean;
  sections: GitDiffSection[];
};

export type GitLocalBranch = {
  name: string;
  headId: string;
  current: boolean;
  upstream?: string;
};

export type GitRemoteBranch = {
  name: string;
  headId: string;
  remote: string;
  branch: string;
};

export type GitComparableBranch = {
  name: string;
  kind: "local" | "remote";
  headId: string;
};

export type GitBranchesListResult = {
  workspaceRoot: string;
  currentBranch: string | null;
  headId: string | null;
  detached: boolean;
  local: GitLocalBranch[];
  remote: GitRemoteBranch[];
  comparable: GitComparableBranch[];
};

export type GitCommitResult = {
  commitId: string;
  branch: string;
  message: string;
  files: number;
};

export type GitPushResult = {
  branch: string;
  upstream: string;
  commitId: string;
  pushed: true;
};

export type GitCompareFile = {
  path: string;
  kind: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">;
  additions: number;
  deletions: number;
  isBinary: boolean;
};

export type GitCompareResult = {
  base: string;
  head: string;
  mergeBase: string;
  files: GitCompareFile[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
  summary: string;
  patch: string;
  truncated: boolean;
};

export type GitChangeSelection =
  | { scope: "all"; expectedSnapshotId: string }
  | { scope: "file"; path: string; expectedSnapshotId: string };

export type GitRestorePreview = {
  snapshotId: string;
  selectedPaths: string[];
  restoreFromHeadPaths: string[];
  deletePaths: string[];
  warning?: string;
};

export type GitRestoreRequest = GitChangeSelection & {
  confirmed: boolean;
};

export type GitRestoreResult = {
  attemptedPaths: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  unresolvedPaths: string[];
  remaining: GitChangesSnapshot;
};

/**
 * A review acceptance is application state, not a Git operation. Persist this
 * record in the caller's event store and invalidate it when snapshotId changes.
 */
export type GitReviewAcceptance = {
  id: string;
  semantics: "review-only";
  snapshotId: string;
  runId?: string;
  runPatchSnapshotId?: string;
  acceptedAt: string;
  scope: GitChangeSelection["scope"];
  paths: string[];
  additions: number;
  deletions: number;
};

export type GitRunReviewAcceptance = GitReviewAcceptance & {
  runId: string;
  runPatchSnapshotId: string;
};

type ParsedStatus = {
  recordType: "ordinary" | "renamed" | "unmerged" | "untracked";
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  fingerprintFields: string[];
};

type GitCommandOptions = {
  acceptedExitCodes?: number[];
  environment?: NodeJS.ProcessEnv;
  mutating?: boolean;
  timeoutMs?: number;
};

export type GitChangesServiceOptions = {
  gitExecutable?: string;
  processTermination?: ChildProcessTerminationOptions;
};

export type GitRunBaseline = {
  id: string;
  runId: string;
  workspaceRoot: string;
  createdAt: string;
  treeId: string;
  /** Read-only fingerprint of the real Git index at Run start. */
  indexSnapshotId: string;
  headId?: string;
  ignoredFilesExcluded: true;
};

export type GitRunFileChange = {
  path: string;
  kind: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">;
  additions: number;
  deletions: number;
  isBinary: boolean;
};

export type GitRunPatch = {
  id: string;
  runId: string;
  baselineId: string;
  workspaceRoot: string;
  generatedAt: string;
  beforeTreeId: string;
  afterTreeId: string;
  /** Index fingerprints make it possible to refuse unsafe staged restores. */
  beforeIndexSnapshotId: string;
  afterIndexSnapshotId: string;
  snapshotId: string;
  files: GitRunFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
};

export type GitRunChangeSelection = {
  baseline: GitRunBaseline;
  patch: GitRunPatch;
  expectedSnapshotId: string;
  /** Omit paths to select every path attributed to the Run. */
  paths?: string[];
};

export type GitRunDiffParams = {
  baseline: GitRunBaseline;
  patch: GitRunPatch;
  expectedSnapshotId: string;
  path: string;
};

export type GitRunFileDiff = {
  snapshotId: string;
  runId: string;
  runPatchSnapshotId: string;
  beforeTreeId: string;
  afterTreeId: string;
  path: string;
  kind: GitRunFileChange["kind"];
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
};

export type GitRunRestoreConflictReason =
  | "WORKTREE_CHANGED_AFTER_RUN"
  | "INDEX_CHANGED_DURING_RUN"
  | "INDEX_CHANGED_AFTER_RUN"
  | "INCOMPLETE_PATH_GROUP";

export type GitRunRestoreConflict = {
  path?: string;
  reason: GitRunRestoreConflictReason;
  message: string;
};

export type GitRunRestoreSelection = GitRunChangeSelection;

export type GitRunRestorePreview = {
  snapshotId: string;
  currentTreeId: string;
  currentIndexSnapshotId: string;
  selectedPaths: string[];
  restorePaths: string[];
  deletePaths: string[];
  conflicts: GitRunRestoreConflict[];
  warning?: string;
};

export type GitRunRestoreRequest = GitRunRestoreSelection & {
  confirmed: boolean;
};

export type GitRunRestoreResult = {
  snapshotId: string;
  attemptedPaths: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  unresolvedPaths: string[];
  beforeTreeId: string;
  afterTreeId: string;
  indexSnapshotId: string;
};

type GitCommandError = Error & {
  code?: number | string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function normalizeExitCode(error: GitCommandError): number | undefined {
  if (typeof error.code === "number") return error.code;
  if (typeof error.code === "string" && /^\d+$/.test(error.code)) return Number(error.code);
  return undefined;
}

function changeKind(status: ParsedStatus): GitChangeKind {
  const code = `${status.indexStatus}${status.worktreeStatus}`;
  if (status.recordType === "unmerged" || code.includes("U") || ["AA", "DD"].includes(code)) {
    return "unmerged";
  }
  if (code.includes("R")) return "renamed";
  if (code.includes("C")) return "copied";
  if (code.includes("D")) return "deleted";
  if (code.includes("A") || status.recordType === "untracked") return "added";
  if (code.includes("T")) return "type-changed";
  if (code.includes("M")) return "modified";
  return "unknown";
}

function parsePorcelainV2(output: string): ParsedStatus[] {
  const records = output.split("\0");
  const parsed: ParsedStatus[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("1 ")) {
      const match = /^1 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s.exec(record);
      if (!match) throw new GitChangesError("GIT_FAILED", "Git returned an unsupported ordinary status record");
      parsed.push({
        recordType: "ordinary",
        path: match[8],
        indexStatus: match[1][0],
        worktreeStatus: match[1][1],
        fingerprintFields: match.slice(1, 8),
      });
      continue;
    }

    if (record.startsWith("2 ")) {
      const match = /^2 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s.exec(record);
      const originalPath = records[index + 1];
      if (!match || originalPath === undefined) {
        throw new GitChangesError("GIT_FAILED", "Git returned an unsupported rename status record");
      }
      index += 1;
      parsed.push({
        recordType: "renamed",
        path: match[9],
        originalPath,
        indexStatus: match[1][0],
        worktreeStatus: match[1][1],
        fingerprintFields: [...match.slice(1, 9), originalPath],
      });
      continue;
    }

    if (record.startsWith("u ")) {
      const match = /^u ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s.exec(record);
      if (!match) throw new GitChangesError("GIT_FAILED", "Git returned an unsupported unmerged status record");
      parsed.push({
        recordType: "unmerged",
        path: match[10],
        indexStatus: match[1][0],
        worktreeStatus: match[1][1],
        fingerprintFields: match.slice(1, 10),
      });
      continue;
    }

    if (record.startsWith("? ")) {
      parsed.push({
        recordType: "untracked",
        path: record.slice(2),
        indexStatus: "?",
        worktreeStatus: "?",
        fingerprintFields: ["?"],
      });
      continue;
    }

    if (!record.startsWith("! ")) {
      throw new GitChangesError("GIT_FAILED", "Git returned an unsupported status record");
    }
  }

  return parsed;
}

function parseNumStat(output: string): GitDiffStat {
  if (!output) return { additions: 0, deletions: 0, isBinary: false };
  const firstTab = output.indexOf("\t");
  const secondTab = firstTab < 0 ? -1 : output.indexOf("\t", firstTab + 1);
  if (firstTab < 0 || secondTab < 0) return { additions: 0, deletions: 0, isBinary: false };

  const additions = output.slice(0, firstTab);
  const deletions = output.slice(firstTab + 1, secondTab);
  const isBinary = additions === "-" || deletions === "-";
  return {
    additions: isBinary ? 0 : Number.parseInt(additions, 10) || 0,
    deletions: isBinary ? 0 : Number.parseInt(deletions, 10) || 0,
    isBinary,
  };
}

function runChangeKind(status: string): GitRunFileChange["kind"] {
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "T") return "type-changed";
  if (status === "M") return "modified";
  return "unknown";
}

function parseRunNameStatus(output: string): Array<{ status: string; path: string }> {
  const records = output.split("\0").filter(Boolean);
  if (records.length % 2 !== 0) {
    throw new GitChangesError("GIT_FAILED", "Git returned an invalid Run-owned name-status stream");
  }
  const parsed: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < records.length; index += 2) {
    parsed.push({ status: records[index].slice(0, 1), path: records[index + 1] });
  }
  return parsed;
}

function parseRunNumStats(output: string): Map<string, GitDiffStat> {
  const stats = new Map<string, GitDiffStat>();
  for (const record of output.split("\0")) {
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const path = record.slice(secondTab + 1);
    stats.set(path, parseNumStat(`${record}\0`));
  }
  return stats;
}

function isGitObjectId(value: string): boolean {
  return /^[a-f0-9]{40,64}$/.test(value);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function nonInteractiveGitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GCM_INTERACTIVE: "Never",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
  };
}

function runPatchSnapshotId(
  baseline: GitRunBaseline,
  afterTreeId: string,
  afterIndexSnapshotId: string,
  files: GitRunFileChange[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      baseline.id,
      baseline.runId,
      baseline.workspaceRoot,
      baseline.treeId,
      baseline.indexSnapshotId,
      afterTreeId,
      afterIndexSnapshotId,
      files,
    ]))
    .digest("hex");
}

function sumStats(layers: Partial<Record<GitDiffLayer, GitDiffStat>>): GitDiffStat {
  return Object.values(layers).reduce<GitDiffStat>((total, item) => ({
    additions: total.additions + item.additions,
    deletions: total.deletions + item.deletions,
    isBinary: total.isBinary || item.isBinary,
  }), { additions: 0, deletions: 0, isBinary: false });
}

function scanWorkingFile(absolutePath: string): { stat: GitDiffStat; fingerprint: string } {
  const metadata = lstatSync(absolutePath);
  if (metadata.isDirectory()) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: true },
      fingerprint: `directory:${metadata.size}:${metadata.mtimeMs}`,
    };
  }
  if (metadata.isSymbolicLink()) {
    const target = readlinkSync(absolutePath);
    return {
      stat: { additions: target ? 1 : 0, deletions: 0, isBinary: false },
      fingerprint: `symlink:${target}`,
    };
  }
  if (!metadata.isFile()) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: true },
      fingerprint: `special:${metadata.mode}:${metadata.size}:${metadata.mtimeMs}`,
    };
  }
  if (metadata.size > MAX_FILE_SCAN_BYTES) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: true },
      fingerprint: `large:${metadata.size}:${metadata.mtimeMs}`,
    };
  }

  const descriptor = openSync(absolutePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let totalBytes = 0;
  let newlineCount = 0;
  let lastByte = -1;
  let binaryProbeRemaining = 8_000;
  let isBinary = false;
  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      totalBytes += bytesRead;
      lastByte = chunk[chunk.length - 1];
      for (let index = 0; index < bytesRead; index += 1) {
        if (chunk[index] === 10) newlineCount += 1;
        if (binaryProbeRemaining > 0 && chunk[index] === 0) isBinary = true;
        if (binaryProbeRemaining > 0) binaryProbeRemaining -= 1;
      }
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(descriptor);
  }

  return {
    stat: {
      additions: isBinary ? 0 : totalBytes === 0 ? 0 : newlineCount + (lastByte === 10 ? 0 : 1),
      deletions: 0,
      isBinary,
    },
    fingerprint: hash.digest("hex"),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await mapper(values[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export class GitChangesService {
  readonly workspaceRoot: string;
  private readonly gitExecutable: string;
  private readonly processTermination: ChildProcessTerminationOptions;
  private repositoryRoot: string | undefined;
  private readonly activeCommands = new Set<ChildProcess>();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private readonly shutdownController = new AbortController();
  private mutationQueue: Promise<void> = Promise.resolve();
  private shutdownPromise: Promise<void> | undefined;
  private disposed = false;

  constructor(workspaceRoot: string, options: GitChangesServiceOptions = {}) {
    const resolved = resolve(workspaceRoot);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new GitChangesError("NOT_REPOSITORY", "Workspace root must be an existing directory");
    }
    this.workspaceRoot = realpathSync(resolved);
    this.gitExecutable = options.gitExecutable ?? "git";
    this.processTermination = options.processTermination ?? {};
  }

  dispose(): Promise<void> {
    this.shutdownPromise ??= (async () => {
      this.disposed = true;
      const activeCommands = [...this.activeCommands];
      this.shutdownController.abort("Rux Runtime is stopping");
      await awaitAllCleanup(activeCommands.map((child) => (
        ensureChildProcessGroupTerminated(child, this.processTermination)
      )), "Git command");
      await Promise.allSettled([...this.activeOperations, this.mutationQueue]);
    })();
    return this.shutdownPromise;
  }

  forceDispose(): void {
    this.disposed = true;
    this.shutdownController.abort("Rux Runtime was force-stopped");
    for (const child of this.activeCommands) forceKillChildProcessGroup(child);
  }

  async listBranches(): Promise<GitBranchesListResult> {
    await this.ensureRepository();
    const [refsOutput, currentResult, headResult, remotesOutput] = await Promise.all([
      this.runGit([
        "for-each-ref",
        "--format=%(refname)%09%(objectname)%09%(upstream:short)%09%(symref)",
        "refs/heads",
        "refs/remotes",
      ]),
      this.runGitResult(["symbolic-ref", "--quiet", "--short", "HEAD"], {
        acceptedExitCodes: [0, 1, 128],
      }),
      this.runGitResult(["rev-parse", "--verify", "HEAD"], {
        acceptedExitCodes: [0, 128],
      }),
      this.runGit(["remote"]),
    ]);
    const currentBranch = currentResult.exitCode === 0
      ? currentResult.stdout.trim() || null
      : null;
    const headId = headResult.exitCode === 0 && isGitObjectId(headResult.stdout.trim())
      ? headResult.stdout.trim()
      : null;
    const remoteNames = remotesOutput.split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length || left.localeCompare(right));
    const local: GitLocalBranch[] = [];
    const remote: GitRemoteBranch[] = [];

    for (const line of refsOutput.split(/\r?\n/)) {
      if (!line) continue;
      const [refName, objectId, upstream = "", symbolicTarget = ""] = line.split("\t");
      if (!refName || !isGitObjectId(objectId)) {
        throw new GitChangesError("GIT_FAILED", "Git returned an invalid branch reference");
      }
      if (refName.startsWith("refs/heads/")) {
        const name = refName.slice("refs/heads/".length);
        local.push({
          name,
          headId: objectId,
          current: name === currentBranch,
          ...(upstream ? { upstream } : {}),
        });
        continue;
      }
      if (!refName.startsWith("refs/remotes/") || symbolicTarget) continue;
      const name = refName.slice("refs/remotes/".length);
      const remoteName = remoteNames.find((candidate) => name.startsWith(`${candidate}/`));
      if (!remoteName) continue;
      const branch = name.slice(remoteName.length + 1);
      if (!branch) continue;
      remote.push({ name, headId: objectId, remote: remoteName, branch });
    }

    local.sort((left, right) => left.name.localeCompare(right.name));
    remote.sort((left, right) => left.name.localeCompare(right.name));
    const comparable: GitComparableBranch[] = [
      ...local.filter((branch) => !branch.current).map((branch) => ({
        name: branch.name,
        kind: "local" as const,
        headId: branch.headId,
      })),
      ...remote.map((branch) => ({
        name: branch.name,
        kind: "remote" as const,
        headId: branch.headId,
      })),
    ];

    return {
      workspaceRoot: this.workspaceRoot,
      currentBranch,
      headId,
      detached: currentBranch === null && headId !== null,
      local,
      remote,
      comparable,
    };
  }

  async switchBranch(input: { branch: string }): Promise<GitBranchesListResult> {
    return this.serializeMutation(() => this.switchBranchUnlocked(input));
  }

  async createWorktree(input: { path: string; branch: string; confirmed: true }): Promise<{ path: string; branch: string; headId: string; createdBranch: boolean }> {
    return this.serializeMutation(() => this.createWorktreeUnlocked(input));
  }

  private async createWorktreeUnlocked(input: { path: string; branch: string; confirmed: true }): Promise<{ path: string; branch: string; headId: string; createdBranch: boolean }> {
    if (input.confirmed !== true) throw new GitChangesError("CONFIRMATION_REQUIRED", "Creating a worktree requires explicit confirmation");
    const repositoryRoot = await this.assertRepositoryRootWorkspace();
    if (!isAbsolute(input.path)) throw new GitChangesError("INVALID_PATH", "Worktree target must be an absolute path selected by the user");
    const requestedTarget = resolve(input.path);
    if (requestedTarget === dirname(requestedTarget)) throw new GitChangesError("INVALID_PATH", "Filesystem root cannot be used as a worktree target");
    if (existsSync(requestedTarget)) throw new GitChangesError("WORKTREE_TARGET_EXISTS", "Worktree target already exists");
    const targetParent = dirname(requestedTarget);
    if (!existsSync(targetParent) || !statSync(targetParent).isDirectory()) throw new GitChangesError("INVALID_PATH", "Worktree target parent directory does not exist");
    const canonicalParent = realpathSync(targetParent);
    const targetName = requestedTarget.slice(targetParent.length + (targetParent.endsWith(sep) ? 0 : 1));
    if (!targetName || targetName.includes(sep) || targetName === "." || targetName === "..") throw new GitChangesError("INVALID_PATH", "Worktree target name is invalid");
    const target = join(canonicalParent, targetName);
    const commonDirRaw = (await this.runGit(["rev-parse", "--git-common-dir"])).trim();
    const commonDir = realpathSync(resolve(repositoryRoot, commonDirRaw));
    const commonRelative = relative(commonDir, target);
    if (commonRelative === "" || (!isAbsolute(commonRelative) && commonRelative !== ".." && !commonRelative.startsWith(`..${sep}`))) throw new GitChangesError("INVALID_PATH", "Worktree target cannot be inside Git metadata");

    const branch = input.branch.trim();
    const branchCheck = await this.runGitResult(["check-ref-format", "--branch", branch], { acceptedExitCodes: [0, 1, 128] });
    if (branchCheck.exitCode !== 0) throw new GitChangesError("INVALID_PATH", "Git branch name is invalid");
    const worktreeList = await this.runGit(["worktree", "list", "--porcelain"]);
    if (worktreeList.split(/\n\s*\n/).some((record) => record.split("\n").includes(`branch refs/heads/${branch}`))) {
      throw new GitChangesError("WORKTREE_BRANCH_IN_USE", `Branch ${branch} is already checked out by another worktree`);
    }
    const branchResult = await this.runGitResult(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { acceptedExitCodes: [0, 1, 128] });
    const createdBranch = branchResult.exitCode !== 0;
    const args = createdBranch
      ? ["worktree", "add", "--no-track", "-b", branch, "--", target, "HEAD"]
      : ["worktree", "add", "--no-track", "--", target, branch];
    try {
      await this.runGit(args, { environment: nonInteractiveGitEnvironment(), mutating: true, timeoutMs: 120_000 });
    } catch {
      throw new GitChangesError("WORKTREE_CREATE_FAILED", `Git could not create worktree ${target}; inspect repository hooks and branch state`);
    }
    const createdList = await this.runGit(["worktree", "list", "--porcelain"]);
    if (!createdList.split(/\n\s*\n/).some((record) => record.split("\n").includes(`worktree ${target}`))) {
      throw new GitChangesError("WORKTREE_CREATE_FAILED", "Git did not report the newly created worktree");
    }
    const headId = (await this.runGit(["rev-parse", "--verify", `refs/heads/${branch}`])).trim();
    if (!isGitObjectId(headId)) throw new GitChangesError("WORKTREE_CREATE_FAILED", "Git did not report the new worktree HEAD");
    return { path: realpathSync(target), branch, headId, createdBranch };
  }

  private async switchBranchUnlocked(input: { branch: string }): Promise<GitBranchesListResult> {
    await this.assertRepositoryRootWorkspace();
    const branch = input.branch.trim();
    const branches = await this.listBranches();
    if (!branches.local.some((candidate) => candidate.name === branch)) {
      throw new GitChangesError("BRANCH_NOT_FOUND", `Local branch does not exist: ${branch}`);
    }
    if (branches.currentBranch === branch) return branches;
    try {
      await this.runGit(["switch", "--no-guess", "--no-recurse-submodules", "--", branch], {
        environment: nonInteractiveGitEnvironment(),
        mutating: true,
        timeoutMs: 60_000,
      });
    } catch {
      throw new GitChangesError(
        "BRANCH_SWITCH_FAILED",
        `Git could not switch to local branch ${branch}; resolve working tree conflicts and retry`,
      );
    }
    return this.listBranches();
  }

  async commitStaged(input: { message: string }): Promise<GitCommitResult> {
    return this.serializeMutation(() => this.commitStagedUnlocked(input));
  }

  private async commitStagedUnlocked(input: { message: string }): Promise<GitCommitResult> {
    await this.assertRepositoryRootWorkspace();
    const message = input.message.trim();
    if (!message) {
      throw new GitChangesError("INVALID_COMMIT_MESSAGE", "Commit message must not be empty");
    }
    const branches = await this.listBranches();
    if (!branches.currentBranch) {
      throw new GitChangesError("DETACHED_HEAD", "A local branch must be checked out before committing");
    }
    const stagedOutput = await this.runGit(["diff", "--cached", "--name-only", "-z", "--", "."]);
    const stagedPaths = stagedOutput.split("\0").filter(Boolean);
    if (stagedPaths.length === 0) {
      throw new GitChangesError("NO_STAGED_CHANGES", "There are no staged changes to commit");
    }
    try {
      await this.runGit(["commit", "--quiet", "--no-gpg-sign", "-m", message], {
        environment: {
          ...nonInteractiveGitEnvironment(),
          GIT_EDITOR: "true",
          GIT_MERGE_AUTOEDIT: "no",
        },
        mutating: true,
        timeoutMs: 120_000,
      });
    } catch {
      throw new GitChangesError(
        "COMMIT_FAILED",
        "Git could not commit the staged changes; check repository identity, hooks, and index state",
      );
    }
    const commitId = (await this.runGit(["rev-parse", "--verify", "HEAD"])).trim();
    if (!isGitObjectId(commitId)) {
      throw new GitChangesError("COMMIT_FAILED", "Git did not report the created commit id");
    }
    return {
      commitId,
      branch: branches.currentBranch,
      message,
      files: stagedPaths.length,
    };
  }

  async pushCurrent(input: { confirmed: true }): Promise<GitPushResult> {
    return this.serializeMutation(() => this.pushCurrentUnlocked(input));
  }

  private async pushCurrentUnlocked(input: { confirmed: true }): Promise<GitPushResult> {
    if (input.confirmed !== true) {
      throw new GitChangesError("CONFIRMATION_REQUIRED", "Push requires explicit confirmation");
    }
    await this.assertRepositoryRootWorkspace();
    const branches = await this.listBranches();
    const branch = branches.currentBranch;
    if (!branch || !branches.headId) {
      throw new GitChangesError("DETACHED_HEAD", "A committed local branch must be checked out before pushing");
    }
    const upstreamRef = (await this.runGit([
      "for-each-ref",
      "--format=%(upstream)",
      `refs/heads/${branch}`,
    ])).trim();
    if (!upstreamRef.startsWith("refs/remotes/")) {
      throw new GitChangesError("NO_UPSTREAM", `Current branch ${branch} has no configured remote upstream`);
    }
    const remoteNames = (await this.runGit(["remote"])).split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length || left.localeCompare(right));
    const shortUpstream = upstreamRef.slice("refs/remotes/".length);
    const remote = remoteNames.find((candidate) => shortUpstream.startsWith(`${candidate}/`));
    if (!remote || remote === ".") {
      throw new GitChangesError("NO_UPSTREAM", `Current branch ${branch} has no configured remote upstream`);
    }
    const upstreamBranch = shortUpstream.slice(remote.length + 1);
    if (!upstreamBranch) {
      throw new GitChangesError("NO_UPSTREAM", `Current branch ${branch} has no configured remote upstream`);
    }
    try {
      await this.runGit([
        "push",
        "--porcelain",
        "--no-all",
        "--no-mirror",
        "--no-tags",
        "--no-follow-tags",
        "--no-force",
        "--no-force-with-lease",
        "--no-set-upstream",
        "--no-signed",
        "--recurse-submodules=no",
        "--",
        remote,
        `${branches.headId}:refs/heads/${upstreamBranch}`,
      ], {
        environment: {
          ...nonInteractiveGitEnvironment(),
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: "credential.interactive",
          GIT_CONFIG_VALUE_0: "false",
          GIT_CONFIG_KEY_1: `remote.${remote}.mirror`,
          GIT_CONFIG_VALUE_1: "false",
        },
        mutating: true,
        timeoutMs: 120_000,
      });
    } catch {
      throw new GitChangesError(
        "PUSH_FAILED",
        `Git could not push ${branch} to its configured upstream; no remote or upstream was created`,
      );
    }
    return {
      branch,
      upstream: `${remote}/${upstreamBranch}`,
      commitId: branches.headId,
      pushed: true,
    };
  }

  async compareBranch(input: { base: string }): Promise<GitCompareResult> {
    await this.ensureRepository();
    const base = input.base.trim();
    const branches = await this.listBranches();
    const localBase = branches.local.find((candidate) => candidate.name === base);
    const remoteBase = branches.remote.find((candidate) => candidate.name === base);
    if (!localBase && !remoteBase) {
      throw new GitChangesError("COMPARE_BASE_NOT_FOUND", `Comparable branch does not exist: ${base}`);
    }
    if (!branches.headId) {
      throw new GitChangesError("COMPARE_FAILED", "The current workspace has no HEAD commit to compare");
    }
    const baseHeadId = localBase?.headId ?? remoteBase!.headId;
    let mergeBase: string;
    try {
      mergeBase = (await this.runGit(["merge-base", baseHeadId, branches.headId])).trim();
    } catch {
      throw new GitChangesError("COMPARE_FAILED", `Git could not find a merge base for ${base}`);
    }
    if (!isGitObjectId(mergeBase)) {
      throw new GitChangesError("COMPARE_FAILED", `Git did not report a valid merge base for ${base}`);
    }
    let files: GitCompareFile[];
    let rawPatch: string;
    try {
      [files, rawPatch] = await Promise.all([
        this.compareTrees(mergeBase, branches.headId),
        this.runGit([
          "diff",
          "--relative",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          mergeBase,
          branches.headId,
          "--",
          ".",
        ], { environment: { GIT_ATTR_SOURCE: branches.headId } }),
      ]);
    } catch (error) {
      if (error instanceof GitChangesError && error.code === "INVALID_PATH") throw error;
      throw new GitChangesError("COMPARE_FAILED", `Git could not compare ${base} with HEAD`);
    }
    const totals = {
      files: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      binaryFiles: files.filter((file) => file.isBinary).length,
    };
    const truncated = Buffer.byteLength(rawPatch) > MAX_COMPARE_PATCH_BYTES;
    const patch = truncated
      ? `${Buffer.from(rawPatch).subarray(0, MAX_COMPARE_PATCH_BYTES).toString("utf8")}\n… [patch truncated]`
      : rawPatch;
    return {
      base,
      head: branches.headId,
      mergeBase,
      files,
      totals,
      summary: `${totals.files} files changed, ${totals.additions} insertions(+), ${totals.deletions} deletions(-)`,
      patch,
      truncated,
    };
  }

  async listChanges(): Promise<GitChangesSnapshot> {
    const repositoryRoot = await this.ensureRepository();
    const workspaceIsRepositoryRoot = repositoryRoot === this.workspaceRoot;
    const statusOutput = await this.runGit([
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
      "--ignored=no",
      ...(workspaceIsRepositoryRoot ? [] : ["--no-renames"]),
      "--",
      ".",
    ]);
    const statuses = parsePorcelainV2(statusOutput);

    const enriched = await mapWithConcurrency(statuses, 6, async (status) => {
      const normalizedPath = this.authorizePath(
        this.repositoryPathToWorkspace(status.path, repositoryRoot),
      ).relativePath;
      const originalPath = status.originalPath
        ? this.authorizePath(this.repositoryPathToWorkspace(status.originalPath, repositoryRoot)).relativePath
        : undefined;
      const untracked = status.recordType === "untracked";
      const staged = !untracked && status.indexStatus !== ".";
      const unstaged = untracked || status.worktreeStatus !== ".";
      const layers: Partial<Record<GitDiffLayer, GitDiffStat>> = {};
      let worktreeFingerprint: string;

      if (staged) layers.staged = await this.readDiffStat("staged", normalizedPath);
      if (unstaged && !untracked) layers.unstaged = await this.readDiffStat("unstaged", normalizedPath);
      if (untracked) {
        const inspected = scanWorkingFile(this.authorizePath(normalizedPath).absolutePath);
        layers.untracked = inspected.stat;
        worktreeFingerprint = inspected.fingerprint;
      } else {
        worktreeFingerprint = await this.workingFingerprint(normalizedPath);
      }

      const total = sumStats(layers);
      const change: GitFileChange = {
        path: normalizedPath,
        originalPath,
        kind: changeKind(status),
        indexStatus: status.indexStatus,
        worktreeStatus: status.worktreeStatus,
        staged,
        unstaged,
        untracked,
        additions: total.additions,
        deletions: total.deletions,
        isBinary: total.isBinary,
        layers,
      };
      return {
        change,
        fingerprint: [
          normalizedPath,
          originalPath ?? "",
          ...status.fingerprintFields,
          worktreeFingerprint,
          JSON.stringify(layers),
        ],
      };
    });

    const files = enriched.map((item) => item.change)
      .sort((left, right) => left.path.localeCompare(right.path));
    const fingerprintByPath = new Map(enriched.map((item) => [item.change.path, item.fingerprint]));
    const snapshotId = createHash("sha256")
      .update(JSON.stringify(files.map((file) => fingerprintByPath.get(file.path))))
      .digest("hex");

    return {
      workspaceRoot: this.workspaceRoot,
      snapshotId,
      files,
      totals: {
        files: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        binaryFiles: files.filter((file) => file.isBinary).length,
      },
    };
  }

  async getFileDiff(path: string, expectedSnapshotId?: string): Promise<GitFileDiff> {
    const normalizedPath = this.authorizePath(path).relativePath;
    const snapshot = await this.listChanges();
    if (expectedSnapshotId && snapshot.snapshotId !== expectedSnapshotId) {
      throw new GitChangesError("STALE_SNAPSHOT", "Workspace changes no longer match the reviewed snapshot");
    }
    const change = snapshot.files.find((file) => file.path === normalizedPath);
    if (!change) throw new GitChangesError("NOT_CHANGED", "Requested path is not a current workspace change");

    const sections: GitDiffSection[] = [];
    for (const layer of ["staged", "unstaged", "untracked"] as const) {
      if (!change.layers[layer]) continue;
      sections.push(await this.readDiffSection(layer, normalizedPath));
    }

    return {
      snapshotId: snapshot.snapshotId,
      path: change.path,
      originalPath: change.originalPath,
      kind: change.kind,
      isBinary: sections.some((section) => section.isBinary),
      sections,
    };
  }

  async captureRunBaseline(runId: string): Promise<GitRunBaseline> {
    await this.ensureRepository();
    const [treeId, indexSnapshotId] = await Promise.all([
      this.captureWorkspaceTree(),
      this.captureIndexSnapshotId(),
    ]);
    const head = await this.runGitResult(["rev-parse", "--verify", "HEAD"], {
      acceptedExitCodes: [0, 128],
    });
    return {
      id: randomUUID(),
      runId,
      workspaceRoot: this.workspaceRoot,
      createdAt: new Date().toISOString(),
      treeId,
      indexSnapshotId,
      ...(head.exitCode === 0 && head.stdout.trim() ? { headId: head.stdout.trim() } : {}),
      ignoredFilesExcluded: true,
    };
  }

  async compareRunChanges(baseline: GitRunBaseline): Promise<GitRunPatch> {
    if (baseline.workspaceRoot !== this.workspaceRoot) {
      throw new GitChangesError("INVALID_PATH", "Run baseline belongs to a different workspace");
    }
    if (!isGitObjectId(baseline.treeId) || !isSha256(baseline.indexSnapshotId)) {
      throw new GitChangesError("GIT_FAILED", "Run baseline tree id is invalid");
    }
    await this.ensureRepository();
    const [afterTreeId, afterIndexSnapshotId] = await Promise.all([
      this.captureWorkspaceTree(),
      this.captureIndexSnapshotId(),
    ]);
    const files = await this.compareTrees(baseline.treeId, afterTreeId);
    const snapshotId = runPatchSnapshotId(baseline, afterTreeId, afterIndexSnapshotId, files);
    return {
      id: randomUUID(),
      runId: baseline.runId,
      baselineId: baseline.id,
      workspaceRoot: this.workspaceRoot,
      generatedAt: new Date().toISOString(),
      beforeTreeId: baseline.treeId,
      afterTreeId,
      beforeIndexSnapshotId: baseline.indexSnapshotId,
      afterIndexSnapshotId,
      snapshotId,
      files,
      totals: {
        files: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        binaryFiles: files.filter((file) => file.isBinary).length,
      },
    };
  }

  unchangedRunPatch(baseline: GitRunBaseline): GitRunPatch {
    if (baseline.workspaceRoot !== this.workspaceRoot || !isGitObjectId(baseline.treeId) || !isSha256(baseline.indexSnapshotId)) {
      throw new GitChangesError("GIT_FAILED", "Run baseline is invalid for an unchanged patch");
    }
    const files: GitRunPatch["files"] = [];
    return {
      id: randomUUID(),
      runId: baseline.runId,
      baselineId: baseline.id,
      workspaceRoot: this.workspaceRoot,
      generatedAt: new Date().toISOString(),
      beforeTreeId: baseline.treeId,
      afterTreeId: baseline.treeId,
      beforeIndexSnapshotId: baseline.indexSnapshotId,
      afterIndexSnapshotId: baseline.indexSnapshotId,
      snapshotId: runPatchSnapshotId(baseline, baseline.treeId, baseline.indexSnapshotId, files),
      files,
      totals: { files: 0, additions: 0, deletions: 0, binaryFiles: 0 },
    };
  }

  /**
   * Reads one file directly from the immutable Run baseline/after trees. The
   * current worktree and real index are deliberately absent from this path.
   */
  async getRunFileDiff(request: GitRunDiffParams): Promise<GitRunFileDiff> {
    const { baseline, patch, selectedFiles } = await this.resolveRunChangeSelection({
      baseline: request.baseline,
      patch: request.patch,
      expectedSnapshotId: request.expectedSnapshotId,
      paths: [request.path],
    });
    const change = selectedFiles[0];
    const immutablePatch = change.isBinary
      ? null
      : await this.runGit([
          "diff",
          "--relative",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          baseline.treeId,
          patch.afterTreeId,
          "--",
          change.path,
        ], {
          environment: { GIT_ATTR_SOURCE: patch.afterTreeId },
          timeoutMs: 30_000,
        });
    return {
      snapshotId: patch.snapshotId,
      runId: patch.runId,
      runPatchSnapshotId: patch.snapshotId,
      beforeTreeId: baseline.treeId,
      afterTreeId: patch.afterTreeId,
      path: change.path,
      kind: change.kind,
      additions: change.additions,
      deletions: change.deletions,
      isBinary: change.isBinary,
      patch: immutablePatch,
    };
  }

  /** Records review evidence for an immutable Run patch without Git mutation. */
  async recordRunReviewAcceptance(
    selection: GitRunChangeSelection,
  ): Promise<GitRunReviewAcceptance> {
    const { patch, selectedFiles } = await this.resolveRunChangeSelection(selection);
    return {
      id: randomUUID(),
      semantics: "review-only",
      snapshotId: patch.snapshotId,
      runId: patch.runId,
      runPatchSnapshotId: patch.snapshotId,
      acceptedAt: new Date().toISOString(),
      scope: selectedFiles.length === patch.files.length ? "all" : "file",
      paths: selectedFiles.map((change) => change.path),
      additions: selectedFiles.reduce((sum, change) => sum + change.additions, 0),
      deletions: selectedFiles.reduce((sum, change) => sum + change.deletions, 0),
    };
  }

  /**
   * Builds a non-mutating, snapshot-guarded plan for undoing only the paths
   * attributed to one Run. The real Git index is fingerprinted but never used
   * as a restore target.
   */
  async previewRunRestore(selection: GitRunRestoreSelection): Promise<GitRunRestorePreview> {
    const { baseline, patch, selectedPaths } = await this.resolveRunChangeSelection(selection);
    const [currentTreeId, currentIndexSnapshotId] = await Promise.all([
      this.captureWorkspaceTree(),
      this.captureIndexSnapshotId(),
    ]);
    const changedAfterRun = await this.compareTrees(patch.afterTreeId, currentTreeId);
    const conflicts: GitRunRestoreConflict[] = [];

    if (baseline.indexSnapshotId !== patch.afterIndexSnapshotId) {
      conflicts.push({
        reason: "INDEX_CHANGED_DURING_RUN",
        message: "The real Git index changed during this Run; Rux will not guess which staged state belongs to the Agent.",
      });
    }
    if (currentIndexSnapshotId !== patch.afterIndexSnapshotId) {
      conflicts.push({
        reason: "INDEX_CHANGED_AFTER_RUN",
        message: "The real Git index changed after the Run patch was captured.",
      });
    }

    for (const path of selectedPaths) {
      const concurrent = changedAfterRun.find((change) => pathsOverlap(change.path, path));
      if (concurrent) {
        conflicts.push({
          path,
          reason: "WORKTREE_CHANGED_AFTER_RUN",
          message: `The selected path changed after the Run completed: ${concurrent.path}`,
        });
      }
      const relatedUnselected = patch.files.find((change) => (
        !selectedPaths.includes(change.path) && pathsOverlap(change.path, path)
      ));
      if (relatedUnselected) {
        conflicts.push({
          path,
          reason: "INCOMPLETE_PATH_GROUP",
          message: `This path must be restored together with ${relatedUnselected.path}.`,
        });
      }
      this.assertMutationPathSafe(path);
    }

    const restorePaths: string[] = [];
    const deletePaths: string[] = [];
    for (const path of selectedPaths) {
      if (await this.pathExistsInTree(baseline.treeId, path)) restorePaths.push(path);
      else deletePaths.push(path);
    }

    const unrelatedDrift = changedAfterRun.filter((change) => (
      !selectedPaths.some((path) => pathsOverlap(change.path, path))
    ));
    const warnings: string[] = [];
    if (deletePaths.length > 0) {
      warnings.push("Restore removes files that were created by this Run.");
    }
    if (unrelatedDrift.length > 0) {
      warnings.push(`${unrelatedDrift.length} unrelated post-Run change(s) will be preserved.`);
    }
    if (conflicts.length > 0) {
      warnings.push("Restore is blocked until the listed conflicts are resolved or a new Run patch is captured.");
    }

    return {
      snapshotId: patch.snapshotId,
      currentTreeId,
      currentIndexSnapshotId,
      selectedPaths,
      restorePaths,
      deletePaths,
      conflicts,
      warning: warnings.length > 0 ? warnings.join(" ") : undefined,
    };
  }

  /**
   * Reverses the immutable tree-to-tree Run patch in the worktree only. Git's
   * reverse-apply performs its own content checks, closing the important gap
   * between preview and confirmation without ever passing --index/--cached.
   */
  async restoreRunChanges(request: GitRunRestoreRequest): Promise<GitRunRestoreResult> {
    if (!request.confirmed) {
      throw new GitChangesError("CONFIRMATION_REQUIRED", "Run-owned restore requires explicit user confirmation");
    }

    let preview = await this.previewRunRestore(request);
    this.assertRunRestoreHasNoConflicts(preview);
    const reversePatch = await this.createRunReversePatch(
      request.baseline.treeId,
      request.patch.afterTreeId,
      preview.selectedPaths,
    );
    if (!reversePatch) {
      throw new GitChangesError("STALE_RUN_PATCH", "The selected Run-owned patch is empty or no longer available");
    }

    // Re-evaluate after patch generation so confirmation never relies on a
    // potentially stale preview. Unrelated paths may continue to drift safely.
    preview = await this.previewRunRestore(request);
    this.assertRunRestoreHasNoConflicts(preview);
    const indexBeforeApply = await this.captureIndexSnapshotId();
    if (indexBeforeApply !== preview.currentIndexSnapshotId) {
      throw new GitChangesError("RUN_RESTORE_INDEX_DRIFT", "The real Git index changed while Restore was being prepared");
    }

    const temporaryRoot = mkdtempSync(join(tmpdir(), "rux-git-run-restore-"));
    const patchPath = join(temporaryRoot, "reverse.patch");
    try {
      writeFileSync(patchPath, reversePatch, { encoding: "utf8", mode: 0o600 });
      try {
        await this.runGit([
          "apply",
          "--reverse",
          "--check",
          "--binary",
          "--whitespace=nowarn",
          patchPath,
        ], { timeoutMs: 30_000 });
        if (await this.captureIndexSnapshotId() !== indexBeforeApply) {
          throw new GitChangesError("RUN_RESTORE_INDEX_DRIFT", "The real Git index changed before Restore could be applied");
        }
        await this.runGit([
          "apply",
          "--reverse",
          "--binary",
          "--whitespace=nowarn",
          patchPath,
        ], { mutating: true, timeoutMs: 120_000 });
      } catch (error) {
        if (error instanceof GitChangesError && error.code === "RUN_RESTORE_INDEX_DRIFT") throw error;
        throw new GitChangesError(
          "RUN_RESTORE_STALE_WORKTREE",
          "A selected path changed before the Run-owned patch could be restored",
        );
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    const [afterTreeId, indexAfterApply] = await Promise.all([
      this.captureWorkspaceTree(),
      this.captureIndexSnapshotId(),
    ]);
    if (indexAfterApply !== indexBeforeApply) {
      throw new GitChangesError("RUN_RESTORE_INDEX_DRIFT", "Restore detected an unexpected real Git index change");
    }
    const unresolvedChanges = await this.compareTrees(request.baseline.treeId, afterTreeId);
    const unresolvedPaths = preview.selectedPaths.filter((path) => (
      unresolvedChanges.some((change) => pathsOverlap(change.path, path))
    ));
    const restoredPaths = preview.selectedPaths.filter((path) => !unresolvedPaths.includes(path));

    return {
      snapshotId: request.patch.snapshotId,
      attemptedPaths: preview.selectedPaths,
      restoredPaths,
      deletedPaths: preview.deletePaths.filter((path) => restoredPaths.includes(path)),
      unresolvedPaths,
      beforeTreeId: preview.currentTreeId,
      afterTreeId,
      indexSnapshotId: indexAfterApply,
    };
  }

  async previewRestore(selection: GitChangeSelection): Promise<GitRestorePreview> {
    const { snapshot, selected } = await this.resolveSelection(selection);
    const restoreFromHeadPaths = new Set<string>();
    const deletePaths = new Set<string>();

    for (const change of selected) {
      for (const candidate of [change.path, change.originalPath].filter((value): value is string => Boolean(value))) {
        if (await this.pathExistsInHead(candidate)) restoreFromHeadPaths.add(candidate);
        else deletePaths.add(candidate);
      }
    }

    for (const path of deletePaths) {
      const absolutePath = this.authorizePath(path).absolutePath;
      if (existsSync(absolutePath) && lstatSync(absolutePath).isDirectory()) {
        throw new GitChangesError(
          "UNSUPPORTED_DIRECTORY",
          `Rux will not recursively delete a changed directory: ${path}`,
        );
      }
    }

    return {
      snapshotId: snapshot.snapshotId,
      selectedPaths: selected.map((change) => change.path),
      restoreFromHeadPaths: [...restoreFromHeadPaths].sort(),
      deletePaths: [...deletePaths].sort(),
      warning: deletePaths.size > 0
        ? "Restore permanently deletes the listed untracked or newly-added files."
        : undefined,
    };
  }

  /**
   * Legacy workspace Restore is worktree-only. Staged entries remain byte-for-
   * byte owned by Git/the user; this path never passes --staged or invokes git rm.
   */
  async restore(request: GitRestoreRequest): Promise<GitRestoreResult> {
    if (!request.confirmed) {
      throw new GitChangesError("CONFIRMATION_REQUIRED", "Restore requires explicit user confirmation");
    }
    const preview = await this.previewRestore(request);

    if (preview.restoreFromHeadPaths.length > 0) {
      await this.runGit([
        "restore",
        "--source=HEAD",
        "--worktree",
        "--",
        ...preview.restoreFromHeadPaths,
      ], { mutating: true, timeoutMs: 30_000 });
    }

    for (const path of preview.deletePaths) {
      const absolutePath = this.authorizePath(path).absolutePath;
      if (existsSync(absolutePath)) unlinkSync(absolutePath);
    }

    const remaining = await this.listChanges();
    const remainingPaths = new Set(remaining.files.flatMap((change) => (
      change.originalPath ? [change.path, change.originalPath] : [change.path]
    )));
    const unresolvedPaths = preview.selectedPaths.filter((path) => remainingPaths.has(path));

    return {
      attemptedPaths: preview.selectedPaths,
      restoredPaths: preview.selectedPaths.filter((path) => !remainingPaths.has(path)),
      deletedPaths: preview.deletePaths,
      unresolvedPaths,
      remaining,
    };
  }

  async recordReviewAcceptance(selection: GitChangeSelection): Promise<GitReviewAcceptance> {
    const { snapshot, selected } = await this.resolveSelection(selection);
    return {
      id: randomUUID(),
      semantics: "review-only",
      snapshotId: snapshot.snapshotId,
      acceptedAt: new Date().toISOString(),
      scope: selection.scope,
      paths: selected.map((change) => change.path),
      additions: selected.reduce((sum, change) => sum + change.additions, 0),
      deletions: selected.reduce((sum, change) => sum + change.deletions, 0),
    };
  }

  private assertRunRestoreHasNoConflicts(preview: GitRunRestorePreview): void {
    if (preview.conflicts.length === 0) return;
    const hasIndexDrift = preview.conflicts.some((conflict) => (
      conflict.reason === "INDEX_CHANGED_DURING_RUN" || conflict.reason === "INDEX_CHANGED_AFTER_RUN"
    ));
    const detail = preview.conflicts.map((conflict) => conflict.path ?? conflict.reason).join(", ");
    if (hasIndexDrift) {
      throw new GitChangesError(
        "RUN_RESTORE_INDEX_DRIFT",
        `Run-owned Restore is blocked by Git index drift: ${detail}`,
      );
    }
    const hasWorktreeDrift = preview.conflicts.some((conflict) => (
      conflict.reason === "WORKTREE_CHANGED_AFTER_RUN"
    ));
    throw new GitChangesError(
      hasWorktreeDrift ? "RUN_RESTORE_STALE_WORKTREE" : "RUN_RESTORE_CONFLICT",
      `Run-owned Restore is blocked by a path conflict: ${detail}`,
    );
  }

  private async resolveRunChangeSelection(selection: GitRunChangeSelection): Promise<{
    baseline: GitRunBaseline;
    patch: GitRunPatch;
    selectedPaths: string[];
    selectedFiles: GitRunFileChange[];
  }> {
    const { baseline, patch } = selection;
    if (selection.expectedSnapshotId !== patch.snapshotId) {
      throw new GitChangesError("STALE_RUN_PATCH", "Run patch no longer matches the reviewed snapshot");
    }
    if (
      baseline.workspaceRoot !== this.workspaceRoot
      || patch.workspaceRoot !== this.workspaceRoot
    ) {
      throw new GitChangesError("INVALID_PATH", "Run change data belongs to a different workspace");
    }
    if (
      baseline.id !== patch.baselineId
      || baseline.runId !== patch.runId
      || baseline.treeId !== patch.beforeTreeId
      || baseline.indexSnapshotId !== patch.beforeIndexSnapshotId
      || baseline.ignoredFilesExcluded !== true
    ) {
      throw new GitChangesError("STALE_RUN_PATCH", "Run patch is not linked to the supplied baseline");
    }
    if (
      !isGitObjectId(baseline.treeId)
      || !isGitObjectId(patch.afterTreeId)
      || !isSha256(baseline.indexSnapshotId)
      || !isSha256(patch.beforeIndexSnapshotId)
      || !isSha256(patch.afterIndexSnapshotId)
      || !isSha256(patch.snapshotId)
    ) {
      throw new GitChangesError("STALE_RUN_PATCH", "Run change data contains an invalid immutable snapshot id");
    }

    await this.assertTreeAvailable(baseline.treeId);
    await this.assertTreeAvailable(patch.afterTreeId);
    const authoritativeFiles = await this.compareTrees(baseline.treeId, patch.afterTreeId);
    const authoritativeTotals = {
      files: authoritativeFiles.length,
      additions: authoritativeFiles.reduce((sum, file) => sum + file.additions, 0),
      deletions: authoritativeFiles.reduce((sum, file) => sum + file.deletions, 0),
      binaryFiles: authoritativeFiles.filter((file) => file.isBinary).length,
    };
    const authoritativeSnapshotId = runPatchSnapshotId(
      baseline,
      patch.afterTreeId,
      patch.afterIndexSnapshotId,
      authoritativeFiles,
    );
    if (
      authoritativeSnapshotId !== patch.snapshotId
      || JSON.stringify(authoritativeFiles) !== JSON.stringify(patch.files)
      || JSON.stringify(authoritativeTotals) !== JSON.stringify(patch.totals)
    ) {
      throw new GitChangesError("STALE_RUN_PATCH", "Run patch content does not match its immutable Git trees");
    }

    const availablePaths = new Set(authoritativeFiles.map((file) => file.path));
    const requestedPaths = selection.paths === undefined
      ? authoritativeFiles.map((file) => file.path)
      : selection.paths.map((path) => this.authorizePath(path).relativePath);
    const selectedPaths = [...new Set(requestedPaths)].sort((left, right) => left.localeCompare(right));
    if (selectedPaths.length === 0) {
      throw new GitChangesError("NOT_CHANGED", "The Run patch does not contain any selected changes");
    }
    for (const path of selectedPaths) {
      if (!availablePaths.has(path)) {
        throw new GitChangesError("NOT_CHANGED", `Path is not part of the Run-owned patch: ${path}`);
      }
    }
    const selectedPathSet = new Set(selectedPaths);
    const selectedFiles = authoritativeFiles.filter((file) => selectedPathSet.has(file.path));
    return { baseline, patch, selectedPaths, selectedFiles };
  }

  private async resolveSelection(selection: GitChangeSelection): Promise<{
    snapshot: GitChangesSnapshot;
    selected: GitFileChange[];
  }> {
    const requestedPath = selection.scope === "file"
      ? this.authorizePath(selection.path).relativePath
      : undefined;
    const snapshot = await this.listChanges();
    if (snapshot.snapshotId !== selection.expectedSnapshotId) {
      throw new GitChangesError("STALE_SNAPSHOT", "Workspace changes no longer match the reviewed snapshot");
    }
    if (!requestedPath) return { snapshot, selected: snapshot.files };

    const change = snapshot.files.find((file) => file.path === requestedPath);
    if (!change) throw new GitChangesError("NOT_CHANGED", "Requested path is not a current workspace change");
    return { snapshot, selected: [change] };
  }

  private authorizePath(input: string): { relativePath: string; absolutePath: string } {
    if (!input || input.includes("\0") || isAbsolute(input)) {
      throw new GitChangesError("INVALID_PATH", "Change path must be a non-empty workspace-relative path");
    }
    const absolutePath = resolve(this.workspaceRoot, input);
    const relativePath = relative(this.workspaceRoot, absolutePath);
    if (
      !relativePath
      || relativePath === ".."
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
    ) {
      throw new GitChangesError("INVALID_PATH", "Change path must stay within the authorized workspace");
    }
    return {
      relativePath: relativePath.split(sep).join("/"),
      absolutePath,
    };
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new GitChangesError("GIT_FAILED", "Git service is shutting down"));
    }
    const queued = this.mutationQueue.catch(() => undefined).then(async () => {
      if (this.disposed) throw new GitChangesError("GIT_FAILED", "Git service is shutting down");
      return operation();
    });
    this.mutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async ensureRepository(): Promise<string> {
    if (this.repositoryRoot) return this.repositoryRoot;
    try {
      const inside = (await this.runGit(["rev-parse", "--is-inside-work-tree"])).trim();
      if (inside !== "true") throw new Error("not a work tree");
      const topLevel = realpathSync((await this.runGit(["rev-parse", "--show-toplevel"])).trim());
      const workspaceRelative = relative(topLevel, this.workspaceRoot);
      if (workspaceRelative === ".." || workspaceRelative.startsWith(`..${sep}`) || isAbsolute(workspaceRelative)) {
        throw new Error("workspace is outside work tree");
      }
      this.repositoryRoot = topLevel;
      return topLevel;
    } catch (error) {
      if (error instanceof GitChangesError && error.code !== "GIT_FAILED") throw error;
      throw new GitChangesError("NOT_REPOSITORY", "Workspace is not inside a Git work tree");
    }
  }

  private async assertRepositoryRootWorkspace(): Promise<string> {
    const repositoryRoot = await this.ensureRepository();
    if (repositoryRoot !== this.workspaceRoot) {
      throw new GitChangesError(
        "REPOSITORY_ROOT_REQUIRED",
        "Branch switching, commit, and push require the authorized Workspace to be the Git repository root",
      );
    }
    return repositoryRoot;
  }

  private repositoryPathToWorkspace(path: string, repositoryRoot: string): string {
    const workspacePrefix = relative(repositoryRoot, this.workspaceRoot).split(sep).join("/");
    if (!workspacePrefix) return path;
    const prefix = `${workspacePrefix}/`;
    if (!path.startsWith(prefix)) {
      throw new GitChangesError("INVALID_PATH", "Git reported a change outside the authorized workspace");
    }
    return path.slice(prefix.length);
  }

  private async readDiffStat(layer: GitDiffLayer, path: string): Promise<GitDiffStat> {
    const args = this.diffArgs(layer, path, true);
    const output = await this.runGit(args, {
      acceptedExitCodes: layer === "untracked" ? [0, 1] : [0],
    });
    return parseNumStat(output);
  }

  private async readDiffSection(layer: GitDiffLayer, path: string): Promise<GitDiffSection> {
    const stat = await this.readDiffStat(layer, path);
    if (stat.isBinary) return { layer, ...stat, patch: null };
    const patch = await this.runGit(this.diffArgs(layer, path, false), {
      acceptedExitCodes: layer === "untracked" ? [0, 1] : [0],
    });
    return { layer, ...stat, patch };
  }

  private diffArgs(layer: GitDiffLayer, path: string, numStat: boolean): string[] {
    const format = numStat
      ? ["--numstat", "-z"]
      : ["--no-color", "--no-ext-diff", "--no-textconv"];
    if (layer === "staged") return ["diff", "--cached", ...format, "--", path];
    if (layer === "unstaged") return ["diff", ...format, "--", path];
    return ["diff", "--no-index", ...format, "--", NULL_DEVICE, path];
  }

  private async workingFingerprint(path: string): Promise<string> {
    const absolutePath = this.authorizePath(path).absolutePath;
    if (!existsSync(absolutePath)) return "missing";
    return scanWorkingFile(absolutePath).fingerprint;
  }

  private async compareTrees(beforeTreeId: string, afterTreeId: string): Promise<GitRunFileChange[]> {
    const diffArgs = [beforeTreeId, afterTreeId, "--", "."];
    const options = { environment: { GIT_ATTR_SOURCE: afterTreeId } };
    const [nameStatusOutput, numStatOutput] = await Promise.all([
      this.runGit(["diff", "--relative", "--name-status", "-z", "--no-renames", ...diffArgs], options),
      this.runGit(["diff", "--relative", "--numstat", "-z", "--no-renames", ...diffArgs], options),
    ]);
    const stats = parseRunNumStats(numStatOutput);
    return parseRunNameStatus(nameStatusOutput).map(({ status, path }) => {
      const normalizedPath = this.authorizePath(path).relativePath;
      const stat = stats.get(path) ?? { additions: 0, deletions: 0, isBinary: false };
      return { path: normalizedPath, kind: runChangeKind(status), ...stat };
    }).sort((left, right) => left.path.localeCompare(right.path));
  }

  private async captureIndexSnapshotId(): Promise<string> {
    await this.ensureRepository();
    const entries = await this.runGit(["ls-files", "--stage", "-v", "-z", "--", "."]);
    return createHash("sha256").update(entries).digest("hex");
  }

  private async createRunReversePatch(
    beforeTreeId: string,
    afterTreeId: string,
    paths: string[],
  ): Promise<string> {
    return this.runGit([
      "diff",
      "--binary",
      "--full-index",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      beforeTreeId,
      afterTreeId,
      "--",
      ...paths,
    ], { environment: { GIT_ATTR_SOURCE: afterTreeId } });
  }

  private async assertTreeAvailable(treeId: string): Promise<void> {
    const result = await this.runGitResult(["cat-file", "-e", `${treeId}^{tree}`], {
      acceptedExitCodes: [0, 1, 128],
    });
    if (result.exitCode !== 0) {
      throw new GitChangesError("STALE_RUN_PATCH", "A Git tree required by this Run patch is no longer available");
    }
  }

  private assertMutationPathSafe(path: string): void {
    const { absolutePath } = this.authorizePath(path);
    let cursor = dirname(absolutePath);
    while (cursor !== this.workspaceRoot) {
      const cursorRelative = relative(this.workspaceRoot, cursor);
      if (
        cursorRelative === ".."
        || cursorRelative.startsWith(`..${sep}`)
        || isAbsolute(cursorRelative)
      ) {
        throw new GitChangesError("INVALID_PATH", "Run restore path escaped the authorized workspace");
      }
      try {
        if (lstatSync(cursor).isSymbolicLink()) {
          throw new GitChangesError("INVALID_PATH", `Run restore will not traverse a symbolic-link parent: ${path}`);
        }
      } catch (error) {
        if (error instanceof GitChangesError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new GitChangesError("INVALID_PATH", "Run restore path could not be safely resolved");
      }
      cursor = parent;
    }
    if (existsSync(absolutePath) && lstatSync(absolutePath).isDirectory()) {
      throw new GitChangesError(
        "UNSUPPORTED_DIRECTORY",
        `Run restore will not recursively replace a directory: ${path}`,
      );
    }
  }

  private async pathExistsInTree(treeId: string, path: string): Promise<boolean> {
    const repositoryPath = await this.workspacePathToRepository(path);
    const result = await this.runGitResult(["cat-file", "-e", `${treeId}:${repositoryPath}`], {
      acceptedExitCodes: [0, 1, 128],
    });
    return result.exitCode === 0;
  }

  private async workspacePathToRepository(path: string): Promise<string> {
    const repositoryRoot = await this.ensureRepository();
    const absolutePath = this.authorizePath(path).absolutePath;
    return relative(repositoryRoot, absolutePath).split(sep).join("/");
  }

  private async pathExistsInHead(path: string): Promise<boolean> {
    const repositoryPath = await this.workspacePathToRepository(path);
    const result = await this.runGitResult(["cat-file", "-e", `HEAD:${repositoryPath}`], {
      acceptedExitCodes: [0, 1, 128],
    });
    return result.exitCode === 0;
  }

  private async captureWorkspaceTree(): Promise<string> {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "rux-git-run-index-"));
    const indexPath = join(temporaryRoot, "index");
    const environment = { GIT_INDEX_FILE: indexPath };
    try {
      const head = await this.runGitResult(["rev-parse", "--verify", "HEAD"], {
        acceptedExitCodes: [0, 128],
      });
      if (head.exitCode === 0) {
        await this.runGit(["read-tree", "HEAD"], { environment, mutating: true, timeoutMs: 30_000 });
      } else {
        await this.runGit(["read-tree", "--empty"], { environment, mutating: true, timeoutMs: 30_000 });
      }
      await this.runGit(["add", "-A", "--", "."], {
        environment,
        mutating: true,
        timeoutMs: 120_000,
      });
      const treeId = (await this.runGit(["write-tree"], {
        environment,
        mutating: true,
        timeoutMs: 30_000,
      })).trim();
      if (!/^[a-f0-9]{40,64}$/.test(treeId)) {
        throw new GitChangesError("GIT_FAILED", "Git did not create a valid Run baseline tree");
      }
      return treeId;
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  private async runGit(args: string[], options: GitCommandOptions = {}): Promise<string> {
    return (await this.runGitResult(args, options)).stdout;
  }

  private async runGitResult(args: string[], options: GitCommandOptions = {}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const acceptedExitCodes = options.acceptedExitCodes ?? [0];
    const commandArgs = ["--literal-pathspecs", "-C", this.workspaceRoot, ...args];
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.environment,
      GIT_OPTIONAL_LOCKS: options.mutating ? "1" : "0",
      LC_ALL: "C",
    };

    if (this.disposed) {
      throw new GitChangesError("GIT_FAILED", "Git service is shutting down");
    }

    try {
      let child: ChildProcess | undefined;
      const operation = new Promise<{ stdout: string; stderr: string }>((resolveCommand, rejectCommand) => {
        child = spawn(this.gitExecutable, commandArgs, {
          env: environment,
          windowsHide: true,
          detached: process.platform !== "win32",
          signal: this.shutdownController.signal,
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.activeCommands.add(child);
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        let stdout = "";
        let stderr = "";
        let settled = false;
        let forcedError: GitCommandError | undefined;
        const timeout = setTimeout(() => {
          forcedError = Object.assign(new Error(`Git command timed out after ${options.timeoutMs ?? 10_000}ms`), {
            code: "ETIMEDOUT",
          });
          if (child) forceKillChildProcessGroup(child);
        }, options.timeoutMs ?? 10_000);
        timeout.unref();
        const finish = (error?: GitCommandError, exitCode = 0): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (child) this.activeCommands.delete(child);
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            rejectCommand(error);
          } else if (exitCode === 0) {
            resolveCommand({ stdout, stderr });
          } else {
            rejectCommand(Object.assign(new Error(`Git exited with code ${exitCode}`), {
              code: exitCode,
              stdout,
              stderr,
            }));
          }
        };
        const appendOutput = (target: "stdout" | "stderr", chunk: string): void => {
          if (target === "stdout") stdout += chunk;
          else stderr += chunk;
          if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) <= MAX_GIT_OUTPUT_BYTES) return;
          forcedError = Object.assign(new Error("Git command output exceeded the safety limit"), {
            code: "ENOBUFS",
          });
          if (child) forceKillChildProcessGroup(child);
        };
        child.stdout?.on("data", (chunk: string) => appendOutput("stdout", chunk));
        child.stderr?.on("data", (chunk: string) => appendOutput("stderr", chunk));
        child.once("error", (error) => finish(error as GitCommandError));
        child.once("close", (code) => finish(forcedError, code ?? -1));
      });
      this.activeOperations.add(operation);
      try {
        const result = await operation;
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
      } finally {
        this.activeOperations.delete(operation);
      }
    } catch (unknownError) {
      const error = unknownError as GitCommandError;
      const exitCode = normalizeExitCode(error);
      const stdout = String(error.stdout ?? "");
      const stderr = String(error.stderr ?? "");
      if (exitCode !== undefined && acceptedExitCodes.includes(exitCode)) {
        return { stdout, stderr, exitCode };
      }
      const detail = stderr.trim() || error.message || "unknown Git error";
      throw new GitChangesError("GIT_FAILED", `Git command failed: ${detail}`);
    }
  }
}
