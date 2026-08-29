import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseNumstatZ, parsePorcelainV1Z } from "./git-status";
import type { ResolveProject, RunProcess } from "./ipc-types";

export type GitFile = { path: string; status: string; plus: number; minus: number; untracked: boolean; staged: boolean; unstaged: boolean };
export type GitState = { branch: string; files: GitFile[] };
export type ProjectInstruction = { path: string; content: string };

export class GitService {
  constructor(private readonly resolveProject: ResolveProject, private readonly runGit: (path: string, args: string[]) => Promise<string>, private readonly runProcess: RunProcess, private readonly gitExecutable: () => string) {}

  async status(projectId: string): Promise<GitState> {
    const project = await this.resolveProject(projectId);
    try {
      const branch = (await this.runGit(project.path, ["branch", "--show-current"])).trim() || "HEAD";
      const porcelain = await this.runGit(project.path, ["status", "--porcelain=v1", "-z", "-uall"]);
      let numstat = "";
      try { await this.runGit(project.path, ["rev-parse", "--verify", "HEAD"]); numstat = await this.runGit(project.path, ["diff", "--numstat", "-z", "HEAD"]); } catch {}
      const counts = parseNumstatZ(numstat); const parsed = parsePorcelainV1Z(porcelain);
      const files = await Promise.all(parsed.map(async ({ statusCode, filePath }) => {
        let count = counts.get(filePath) ?? { plus: 0, minus: 0 };
        if (statusCode === "??") try { const content = await readFile(resolve(project.path, filePath)); if (content.length <= 512_000 && !content.subarray(0, 8_000).includes(0)) count = { plus: content.toString("utf8").split(/\r?\n/).filter(Boolean).length, minus: 0 }; } catch {}
        return { path: filePath, status: statusCode, untracked: statusCode === "??", staged: statusCode !== "??" && statusCode[0] !== " ", unstaged: statusCode === "??" || statusCode[1] !== " ", ...count };
      }));
      return { branch, files };
    } catch (error) { if (String(error).includes("not a git repository")) return { branch: "—", files: [] }; throw error; }
  }

  async diff(projectId: string, filePath: string): Promise<string> {
    const project = await this.resolveProject(projectId); const absolute = this.resolveFile(project.path, filePath); const file = (await this.status(projectId)).files.find((item) => item.path === filePath); if (!file) return "";
    if (file.untracked) { const info = await stat(absolute); if (!info.isFile() || info.size > 512_000) return "无法预览此未跟踪文件"; const content = await readFile(absolute); if (content.subarray(0, 8_000).includes(0)) return `二进制文件 · ${Math.ceil(info.size / 1024)} KB`; return content.toString("utf8").split("\n").map((line) => `+ ${line}`).join("\n"); }
    const staged = await this.runGit(project.path, ["diff", "--cached", "--", filePath]); const unstaged = await this.runGit(project.path, ["diff", "--", filePath]); return [staged ? `## 已暂存\n${staged}` : "", unstaged ? `## 未暂存\n${unstaged}` : ""].filter(Boolean).join("\n");
  }

  async listFiles(projectId: string): Promise<string[]> {
    const project = await this.resolveProject(projectId); const ignored = new Set([".git", "node_modules", "release", "dist", "out", ".DS_Store"]); const files: string[] = [];
    const visit = async (directory: string, prefix = ""): Promise<void> => { if (files.length >= 300) return; for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { if (ignored.has(entry.name) || files.length >= 300) continue; const item = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) await visit(join(directory, entry.name), item); else if (entry.isFile()) files.push(item); } };
    await visit(project.path); return files;
  }

  async canonicalFile(projectId: string, filePath: string): Promise<string> { const project = await this.resolveProject(projectId); const canonical = await realpath(this.resolveFile(project.path, filePath)); this.resolveFile(project.path, relative(project.path, canonical)); return canonical; }
  async branches(projectId: string): Promise<string[]> { const project = await this.resolveProject(projectId); try { return (await this.runGit(project.path, ["branch", "--format=%(refname:short)"])).split(/\r?\n/).filter(Boolean); } catch { return []; } }
  async switchBranch(projectId: string, branch: string): Promise<GitState> { const project = await this.resolveProject(projectId); const branches = await this.branches(projectId); if (!branches.includes(branch)) throw new Error("分支不存在"); await this.runGit(project.path, ["switch", branch]); return await this.status(projectId); }
  async remote(projectId: string): Promise<string> { const project = await this.resolveProject(projectId); try { return (await this.runGit(project.path, ["remote", "get-url", "origin"])).trim(); } catch { return ""; } }
  async instructions(projectId: string): Promise<{ files: ProjectInstruction[]; stagedPaths: string[] }> {
    const project = await this.resolveProject(projectId);
    const stagedPaths = (await this.status(projectId)).files.filter((file) => file.staged).map((file) => file.path);
    const candidates = new Set(["AGENTS.md", "RULES.md", "CLAUDE.md", ".clinerules", ".windsurfrules", ".codex/rules.md", ".github/copilot-instructions.md"]);
    for (const path of stagedPaths) {
      let directory = dirname(path);
      while (directory && directory !== ".") { candidates.add(`${directory}/AGENTS.md`); directory = dirname(directory); }
    }
    for (const rulesDirectory of [".cursor/rules", ".codex/rules", ".github/instructions", ".rules"]) {
      try {
        for (const entry of await readdir(join(project.path, rulesDirectory), { withFileTypes: true })) {
          if (entry.isFile() && /\.(md|mdc|txt|rules)$/i.test(entry.name)) candidates.add(`${rulesDirectory}/${entry.name}`);
        }
      } catch {}
    }
    candidates.add(".rules");
    const files: ProjectInstruction[] = [];
    let total = 0;
    for (const path of candidates) {
      if (files.length >= 24 || total >= 256_000) break;
      try {
        const content = await readFile(this.resolveFile(project.path, path), "utf8");
        const safeContent = content.slice(0, Math.min(64_000, 256_000 - total));
        if (safeContent.trim()) { files.push({ path, content: safeContent }); total += safeContent.length; }
      } catch {}
    }
    return { files, stagedPaths };
  }
  async commitPush(projectId: string, message: string, push: boolean, rulesAcknowledged = false): Promise<GitState> { const project = await this.resolveProject(projectId); const guidance = await this.instructions(projectId); if (guidance.files.length && !rulesAcknowledged) throw new Error("提交前必须阅读并确认项目 AGENTS.md / rules"); if (message) { const staged = await this.runProcess(this.gitExecutable(), ["diff", "--cached", "--quiet"], { cwd: project.path, timeoutMs: 30_000 }); if (staged.code === 0) throw new Error("没有已暂存的变更，请先在审查页暂存文件"); await this.runGit(project.path, ["commit", "-m", message]); } if (push) { const remote = await this.remote(projectId); if (!remote) throw new Error("当前项目没有 origin 远程仓库"); const branch = (await this.runGit(project.path, ["branch", "--show-current"])).trim(); if (!branch) throw new Error("当前不在可推送的本地分支上"); await this.runGit(project.path, ["push", "-u", "origin", branch]); } return await this.status(projectId); }
  async stage(projectId: string, paths: string[]): Promise<GitState> { const project = await this.resolveProject(projectId); const allowed = (await this.status(projectId)).files.map((item) => item.path); const selected = paths.filter((path) => allowed.includes(path)); if (!selected.length) throw new Error("没有可暂存的文件"); await this.runGit(project.path, ["add", "--", ...selected]); return await this.status(projectId); }
  async discard(projectId: string, path: string): Promise<GitState> { const project = await this.resolveProject(projectId); const file = (await this.status(projectId)).files.find((item) => item.path === path); if (!file) throw new Error("变更不存在"); if (file.untracked) throw new Error("为避免数据丢失，未跟踪文件不会自动删除"); if (file.status[1] === " ") throw new Error("此文件没有未暂存修改；已暂存内容不会被自动丢弃"); await this.runGit(project.path, ["restore", "--worktree", "--", path]); return await this.status(projectId); }

  private resolveFile(projectPath: string, filePath: string): string { const absolute = resolve(projectPath, filePath); const child = relative(projectPath, absolute); const parentPrefix = `..${process.platform === "win32" ? "\\" : "/"}`; if (!child || child === ".." || child.startsWith(parentPrefix) || isAbsolute(child)) throw new Error("文件路径越界"); return absolute; }
}
