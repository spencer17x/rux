import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "./git-service";

const execute = promisify(execFile);
let root = "";
let service: GitService;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "rux-git-service-"));
  const run = async (args: string[]) => await execute("git", args, { cwd: root, encoding: "utf8" });
  await run(["init"]); await run(["config", "user.email", "rux@example.test"]); await run(["config", "user.name", "Rux Test"]);
  writeFileSync(join(root, "file.txt"), "first\n"); await run(["add", "file.txt"]); await run(["commit", "-m", "initial"]);
  service = new GitService(async () => ({ id: "project", name: "project", path: root, threads: [] }), async (_path, args) => (await execute("git", args, { cwd: root, encoding: "utf8" })).stdout, async (command, args, options) => { try { const result = await execute(command, args, { cwd: options?.cwd, encoding: "utf8" }); return { stdout: result.stdout, stderr: result.stderr, code: 0 }; } catch (error: any) { return { stdout: error.stdout || "", stderr: error.stderr || "", code: error.code || 1 }; } }, () => "git");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("GitService", () => {
  it("tracks, diffs, stages, and preserves staged content when discarding worktree edits", async () => {
    writeFileSync(join(root, "file.txt"), "first\nsecond\n");
    expect((await service.status("project")).files[0]).toMatchObject({ path: "file.txt", unstaged: true, staged: false });
    expect(await service.diff("project", "file.txt")).toContain("未暂存");
    await service.stage("project", ["file.txt"]);
    writeFileSync(join(root, "file.txt"), "first\nsecond\nthird\n");
    await service.discard("project", "file.txt");
    const state = await service.status("project");
    expect(state.files[0]).toMatchObject({ staged: true, unstaged: false });
  });

  it("rejects project path traversal", async () => {
    await expect(service.canonicalFile("project", "../outside.txt")).rejects.toThrow("文件路径越界");
  });

  it("discovers scoped project rules and requires acknowledgement before commit", async () => {
    writeFileSync(join(root, "AGENTS.md"), "Use conventional commit messages.\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "AGENTS.md"), "Run tests for files under src.\n");
    writeFileSync(join(root, "src", "feature.ts"), "export const feature = true;\n");
    await execute("git", ["add", "src/feature.ts"], { cwd: root, encoding: "utf8" });
    const guidance = await service.instructions("project");
    expect(guidance.files.map((file) => file.path)).toEqual(expect.arrayContaining(["AGENTS.md", "src/AGENTS.md"]));
    expect(guidance.stagedPaths).toContain("src/feature.ts");
    await expect(service.commitPush("project", "feat: add feature", false)).rejects.toThrow("必须阅读并确认");
    await service.commitPush("project", "feat: add feature", false, true);
    expect((await execute("git", ["log", "-1", "--pretty=%s"], { cwd: root, encoding: "utf8" })).stdout.trim()).toBe("feat: add feature");
  });
});
