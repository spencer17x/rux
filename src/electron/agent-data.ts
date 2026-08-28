import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { StoredThread, StoredWorkspace } from "./state-database";

export type AgentDataPaths = {
  root: string;
  codexHome: string;
  claudeHome: string;
  piHome: string;
};

export function agentDataPaths(userData: string): AgentDataPaths {
  const root = join(userData, "agents");
  return { root, codexHome: join(root, "codex"), claudeHome: join(root, "claude-code"), piHome: join(root, "pi") };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function filesBelow(root: string): Promise<string[]> {
  if (!await exists(root)) return [];
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  await visit(root);
  return result;
}

async function copyIfMissing(source: string, destination: string): Promise<void> {
  if (!await exists(source) || await exists(destination)) return;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await cp(source, destination, { recursive: true, preserveTimestamps: true });
}

async function moveFile(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination) || !await exists(source) || await exists(destination)) return;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  try { await rename(source, destination); }
  catch { await cp(source, destination, { preserveTimestamps: true }); await rm(source, { force: true }); }
}

function allThreads(workspace: StoredWorkspace): StoredThread[] {
  return [...workspace.projects.flatMap((project) => project.threads), ...workspace.standaloneThreads];
}

export async function prepareAgentData(paths: AgentDataPaths, workspace: StoredWorkspace): Promise<boolean> {
  await Promise.all([paths.codexHome, paths.claudeHome, paths.piHome].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  const defaultCodexHome = process.env.CODEX_HOME || join(process.env.HOME || "", ".codex");
  const defaultClaudeHome = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || "", ".claude");

  // Credentials and user configuration are copied once so the isolated Rux runtime
  // keeps the current account without sharing the conversation store.
  for (const name of ["auth.json", "config.toml"]) await copyIfMissing(join(defaultCodexHome, name), join(paths.codexHome, name));
  for (const name of [".credentials.json", "settings.json", "settings.local.json"]) await copyIfMissing(join(defaultClaudeHome, name), join(paths.claudeHome, name));

  const threads = allThreads(workspace);
  const codexIds = new Set(threads.filter((thread) => (thread.agentId || (thread.codexThreadId ? "codex" : undefined)) === "codex").map((thread) => thread.nativeSessionId || thread.codexThreadId).filter(Boolean) as string[]);
  if (codexIds.size && resolve(defaultCodexHome) !== resolve(paths.codexHome)) {
    for (const source of await filesBelow(join(defaultCodexHome, "sessions"))) {
      const id = [...codexIds].find((candidate) => basename(source).includes(candidate));
      if (!id) continue;
      await moveFile(source, join(paths.codexHome, relative(defaultCodexHome, source)));
    }
  }

  const claudeIds = new Set(threads.filter((thread) => thread.agentId === "claude-code").map((thread) => thread.nativeSessionId).filter(Boolean) as string[]);
  if (claudeIds.size && resolve(defaultClaudeHome) !== resolve(paths.claudeHome)) {
    for (const source of await filesBelow(join(defaultClaudeHome, "projects"))) {
      if (![...claudeIds].some((id) => basename(source) === `${id}.jsonl` || source.includes(`${id}/`))) continue;
      await moveFile(source, join(paths.claudeHome, relative(defaultClaudeHome, source)));
    }
  }

  let workspaceChanged = false;
  for (const thread of threads) {
    if (thread.agentId !== "pi" || !thread.nativeSessionId || !isAbsolute(thread.nativeSessionId)) continue;
    const source = thread.nativeSessionId;
    if (resolve(source).startsWith(`${resolve(paths.piHome)}/`)) continue;
    const destination = join(paths.piHome, "sessions", basename(source));
    await moveFile(source, destination);
    if (await exists(destination)) { thread.nativeSessionId = destination; workspaceChanged = true; }
  }
  return workspaceChanged;
}
