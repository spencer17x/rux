import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

type CodexReasoningEffort = {
  reasoningEffort: ReasoningEffort;
  description: string;
};

type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: CodexReasoningEffort[];
};

type RuxSettings = {
  provider: "codex" | "custom";
  serviceName: string;
  baseUrl: string;
  encryptedApiKey: string;
  hasApiKey: boolean;
  model: string;
  reasoning: ReasoningEffort;
  sandboxMode: SandboxMode;
  uiFontSize: number;
  allowConversationOverride: boolean;
};

type ThreadRecord = {
  id: string;
  title: string;
  codexThreadId?: string;
};

type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  threads: ThreadRecord[];
};

type WorkspaceState = {
  projects: ProjectRecord[];
  standaloneThreads: ThreadRecord[];
};

type GitFile = {
  path: string;
  status: string;
  plus: number;
  minus: number;
  untracked: boolean;
};

const terminalProcesses = new Map<number, ChildProcessWithoutNullStreams>();

function userDataFile(name: string): string {
  return join(app.getPath("userData"), name);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function defaultSettings(): RuxSettings {
  return {
    provider: "codex",
    serviceName: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    encryptedApiKey: "",
    hasApiKey: false,
    model: "",
    reasoning: "high",
    sandboxMode: "workspace-write",
    uiFontSize: 14,
    allowConversationOverride: true,
  };
}

function publicSettings(settings: RuxSettings): Omit<RuxSettings, "encryptedApiKey"> {
  const { encryptedApiKey: _encryptedApiKey, ...rest } = settings;
  return rest;
}

async function loadSettings(): Promise<RuxSettings> {
  const settings = await readJson(userDataFile("settings.json"), defaultSettings());
  return { ...defaultSettings(), ...settings, hasApiKey: Boolean(settings.encryptedApiKey) };
}

async function saveSettings(input: Partial<RuxSettings> & { apiKey?: string }): Promise<RuxSettings> {
  const current = await loadSettings();
  const next: RuxSettings = {
    ...current,
    provider: input.provider === "custom" ? "custom" : input.provider === "codex" ? "codex" : current.provider,
    serviceName: String(input.serviceName ?? current.serviceName).slice(0, 80),
    baseUrl: String(input.baseUrl ?? current.baseUrl).trim(),
    model: String(input.model ?? current.model).trim().slice(0, 120),
    reasoning: ["none", "low", "medium", "high", "xhigh", "max", "ultra"].includes(String(input.reasoning))
      ? (input.reasoning as ReasoningEffort)
      : current.reasoning,
    sandboxMode: ["read-only", "workspace-write", "danger-full-access"].includes(String(input.sandboxMode))
      ? (input.sandboxMode as SandboxMode)
      : current.sandboxMode,
    uiFontSize: Math.min(16, Math.max(12, Number(input.uiFontSize ?? current.uiFontSize) || 14)),
    allowConversationOverride:
      typeof input.allowConversationOverride === "boolean"
        ? input.allowConversationOverride
        : current.allowConversationOverride,
  };

  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法保存 API key");
    }
    next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
    next.hasApiKey = true;
  }

  await writeJson(userDataFile("settings.json"), next);
  return next;
}

function decryptApiKey(settings: RuxSettings): string {
  if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, "base64"));
}

async function loadWorkspace(): Promise<WorkspaceState> {
  const fallback: WorkspaceState = {
    projects: [],
    standaloneThreads: [],
  };
  const workspace = await readJson(userDataFile("workspace.json"), fallback);
  const filteredThreads = workspace.standaloneThreads.filter((thread) => !["compare", "logs"].includes(thread.id));
  if (filteredThreads.length !== workspace.standaloneThreads.length) {
    workspace.standaloneThreads = filteredThreads;
    await saveWorkspace(workspace);
  }

  if (workspace.projects.length === 0 && process.env.ELECTRON_RENDERER_URL) {
    const cwd = process.cwd();
    if (await pathExists(join(cwd, "package.json"))) {
      workspace.projects.push({
        id: randomUUID(),
        name: basename(cwd),
        path: cwd,
        threads: [
          { id: randomUUID(), title: "实现模型连接设置" },
          { id: randomUUID(), title: "设计 Rux Agent 桌面端 UI" },
        ],
      });
      await saveWorkspace(workspace);
    }
  }

  return workspace;
}

async function saveWorkspace(workspace: WorkspaceState): Promise<void> {
  await writeJson(userDataFile("workspace.json"), workspace);
}

function validateProjectName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.length > 80 || clean === "." || clean === ".." || /[\\/:*?"<>|]/.test(clean)) {
    throw new Error("项目名称无效");
  }
  return clean;
}

async function resolveProject(pathOrId: string): Promise<ProjectRecord> {
  const workspace = await loadWorkspace();
  const project = workspace.projects.find((item) => item.id === pathOrId || item.path === pathOrId);
  if (!project) throw new Error("项目不存在或未授权");
  const projectPath = resolve(project.path);
  const info = await stat(projectPath);
  if (!info.isDirectory()) throw new Error("项目目录不可用");
  return { ...project, path: projectPath };
}

function findExecutable(name: "codex" | "git"): string {
  const candidates = name === "codex"
    ? [process.env.CODEX_BIN, "/opt/homebrew/bin/codex", "/usr/local/bin/codex", "codex"]
    : [process.env.GIT_BIN, "/usr/bin/git", "/opt/homebrew/bin/git", "git"];
  return candidates.find(Boolean) as string;
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("操作超时"));
    }, options.timeoutMs ?? 120_000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({ stdout, stderr, code: code ?? 1 });
    });
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

async function codexAppServerRequest<T>(method: string, params: unknown): Promise<T> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(findExecutable("codex"), ["app-server", "--stdio"], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;

    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolvePromise(result as T);
    };

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const handleLine = (line: string) => {
      if (!line.trim().startsWith("{")) return;
      try {
        const message = JSON.parse(line) as {
          id?: number;
          error?: { message?: string };
          result?: T;
        };
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: 2, method, params });
        }
        if (message.id === 2) {
          if (message.error) finish(new Error(message.error.message || `Codex ${method} 请求失败`));
          else finish(undefined, message.result);
        }
      } catch {
        // Ignore diagnostics that are not JSON-RPC messages.
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(`Codex 服务已退出（${code ?? 1}）`));
    });
    const timeout = setTimeout(() => finish(new Error(`Codex ${method} 请求超时`)), 20_000);
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "rux", title: "Rux", version: app.getVersion() }, capabilities: {} },
    });
  });
}

async function loadCodexModels(): Promise<{ models: CodexModel[] }> {
  const result = await codexAppServerRequest<{ data?: CodexModel[] }>("model/list", { includeHidden: false, limit: 100 });
  return { models: (result.data ?? []).filter((model) => !model.hidden) };
}

type CodexAccount = { type: string; email?: string | null; planType?: string };

async function loadCodexAccount(): Promise<{ connected: boolean; account: CodexAccount | null; message: string }> {
  try {
    const result = await codexAppServerRequest<{ account?: CodexAccount | null }>("account/read", { refreshToken: false });
    const account = result.account ?? null;
    return { connected: Boolean(account), account, message: account?.email || account?.type || "" };
  } catch (error) {
    const status = await runProcess(findExecutable("codex"), ["login", "status"], { timeoutMs: 20_000 });
    return { connected: status.code === 0, account: null, message: (status.stdout || status.stderr || String(error)).trim() };
  }
}

async function runGit(projectPath: string, args: string[]): Promise<string> {
  const result = await runProcess(findExecutable("git"), args, { cwd: projectPath, timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Git 操作失败");
  return result.stdout;
}

async function isGitWorkTree(path: string): Promise<boolean> {
  const result = await runProcess(findExecutable("git"), ["rev-parse", "--is-inside-work-tree"], { cwd: path, timeoutMs: 20_000 });
  return result.code === 0 && result.stdout.trim() === "true";
}

function parseCodexOutput(stdout: string): { text: string; threadId?: string } {
  let text = "";
  let threadId: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        thread_id?: string;
        item?: { type?: string; text?: string };
      };
      if (event.type === "thread.started") threadId = event.thread_id;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        text = event.item.text;
      }
    } catch {
      // Ignore non-protocol diagnostics.
    }
  }
  return { text, threadId };
}

async function sendWithCodex(input: {
  projectId?: string;
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandboxMode?: SandboxMode;
  images?: string[];
  webSearch?: boolean;
  threadId?: string;
}): Promise<{ text: string; threadId?: string; diagnostics: string }> {
  const project = input.projectId ? await resolveProject(input.projectId) : null;
  const cwd = project?.path ?? join(app.getPath("userData"), "standalone-workspace");
  await mkdir(cwd, { recursive: true });
  let prompt = input.prompt.trim();
  if (!prompt) throw new Error("消息不能为空");
  const codex = findExecutable("codex");
  const settings = await loadSettings();
  const model = (input.model ?? settings.model).trim();
  const reasoning = input.reasoning ?? settings.reasoning;
  const sandboxMode = input.sandboxMode ?? settings.sandboxMode;
  const fullAccess = sandboxMode === "danger-full-access";
  const autoApprove = sandboxMode === "workspace-write";
  const args = input.threadId ? ["exec", "resume", "--json"] : ["exec", "--json", "-C", cwd];
  if (fullAccess) args.push("--dangerously-bypass-approvals-and-sandbox");
  else if (!input.threadId && autoApprove) args.push("--approve-for-me");
  else if (!input.threadId) args.push("-s", "workspace-write");
  if (!await isGitWorkTree(cwd)) args.push("--skip-git-repo-check");
  if (input.threadId && !fullAccess) {
    args.push("-c", 'sandbox_mode="workspace-write"');
    args.push("-c", `approval_policy=\"${autoApprove ? "never" : "on-request"}\"`);
  }
  if (input.webSearch) {
    if (input.threadId) args.push("-c", 'web_search="live"');
    else args.push("--search");
  }
  if (model && model !== "default") args.push("-m", model);
  args.push("-c", `model_reasoning_effort=\"${reasoning}\"`);
  const contextFiles: string[] = [];
  for (const image of (input.images ?? []).slice(0, 8)) {
    const imagePath = resolve(String(image));
    if (!await pathExists(imagePath)) continue;
    if (/\.(png|jpe?g|gif|webp)$/i.test(imagePath)) args.push("-i", imagePath);
    else contextFiles.push(imagePath);
  }
  if (contextFiles.length) prompt += `\n\n用户选择的上下文文件：\n${contextFiles.map((path) => `- ${path}`).join("\n")}`;
  if (input.threadId) args.push(input.threadId);
  args.push(prompt);
  const result = await runProcess(codex, args, { cwd, timeoutMs: 10 * 60_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Codex 执行失败");
  const parsed = parseCodexOutput(result.stdout);
  if (!parsed.text) throw new Error("Codex 未返回可显示的消息");
  return { ...parsed, diagnostics: result.stderr.trim() };
}

async function sendWithCustomProvider(input: {
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
}): Promise<{ text: string }> {
  const settings = await loadSettings();
  const apiKey = decryptApiKey(settings);
  if (!apiKey) throw new Error("请先保存 API key");
  const model = (input.model || settings.model).trim();
  if (!model || model === "default") throw new Error("请选择模型");
  const endpoint = `${settings.baseUrl.replace(/\/+$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: input.prompt,
      reasoning: { effort: input.reasoning ?? settings.reasoning },
      store: false,
    }),
  });
  const body = await response.json() as { output_text?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `服务返回 ${response.status}`);
  if (!body.output_text) throw new Error("服务未返回文本");
  return { text: body.output_text };
}

async function gitStatus(projectId: string): Promise<{ branch: string; files: GitFile[] }> {
  const project = await resolveProject(projectId);
  try {
    const branch = (await runGit(project.path, ["branch", "--show-current"])).trim() || "HEAD";
    const porcelain = await runGit(project.path, ["status", "--porcelain=v1", "-uall"]);
    let numstat = "";
    try {
      await runGit(project.path, ["rev-parse", "--verify", "HEAD"]);
      numstat = await runGit(project.path, ["diff", "--numstat", "HEAD"]);
    } catch {
      // A newly initialized repository has no HEAD yet; porcelain still reports real files.
    }
    const counts = new Map<string, { plus: number; minus: number }>();
    for (const line of numstat.split(/\r?\n/)) {
      const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
      if (match) counts.set(match[3], { plus: Number(match[1]) || 0, minus: Number(match[2]) || 0 });
    }
    const files = await Promise.all(porcelain.split(/\r?\n/).filter(Boolean).map(async (line) => {
      const statusCode = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()! : rawPath;
      let count = counts.get(filePath) ?? { plus: 0, minus: 0 };
      if (statusCode === "??") {
        try {
          const content = await readFile(resolve(project.path, filePath));
          if (content.length <= 512_000 && !content.subarray(0, 8_000).includes(0)) {
            count = { plus: content.toString("utf8").split(/\r?\n/).filter(Boolean).length, minus: 0 };
          }
        } catch {
          // Keep zero counts for directories and unreadable files.
        }
      }
      return { path: filePath, status: statusCode, untracked: statusCode === "??", ...count };
    }));
    return { branch, files };
  } catch (error) {
    if (String(error).includes("not a git repository")) return { branch: "—", files: [] };
    throw error;
  }
}

async function gitDiff(projectId: string, filePath: string): Promise<string> {
  const project = await resolveProject(projectId);
  const absolute = resolve(project.path, filePath);
  if (!absolute.startsWith(`${project.path}/`)) throw new Error("文件路径越界");
  const status = await gitStatus(projectId);
  const file = status.files.find((item) => item.path === filePath);
  if (!file) return "";
  if (file.untracked) {
    const info = await stat(absolute);
    if (!info.isFile() || info.size > 512_000) return "无法预览此未跟踪文件";
    const content = await readFile(absolute);
    if (content.subarray(0, 8_000).includes(0)) return `二进制文件 · ${Math.ceil(info.size / 1024)} KB`;
    return content.toString("utf8").split("\n").map((line) => `+ ${line}`).join("\n");
  }
  const staged = await runGit(project.path, ["diff", "--cached", "--", filePath]);
  const unstaged = await runGit(project.path, ["diff", "--", filePath]);
  return [staged, unstaged].filter(Boolean).join("\n");
}

async function listProjectFiles(projectId: string): Promise<string[]> {
  const project = await resolveProject(projectId);
  const ignored = new Set([".git", "node_modules", "release", "dist", "out", ".DS_Store"]);
  const files: string[] = [];
  async function visit(directory: string, prefix = ""): Promise<void> {
    if (files.length >= 300) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name) || files.length >= 300) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await visit(project.path);
  return files;
}

async function ensureProjectTemplate(path: string, template: string, name: string): Promise<void> {
  if (template === "react") {
    await mkdir(join(path, "src"), { recursive: true });
    await writeFile(join(path, "package.json"), `${JSON.stringify({ name, private: true, type: "module", scripts: { dev: "vite", build: "vite build" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" } }, null, 2)}\n`);
    await writeFile(join(path, "index.html"), '<div id="root"></div><script type="module" src="/src/main.jsx"></script>\n');
    await writeFile(join(path, "src/main.jsx"), 'import React from "react";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")).render(<main>Hello</main>);\n');
  } else if (template === "node") {
    await writeFile(join(path, "package.json"), `${JSON.stringify({ name, private: true, type: "module", scripts: { start: "node index.js" } }, null, 2)}\n`);
    await writeFile(join(path, "index.js"), 'console.log("Hello from Rux");\n');
  } else {
    await writeFile(join(path, "README.md"), `# ${name}\n`);
  }
}

export function registerBackend(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("settings:get", async () => publicSettings(await loadSettings()));
  ipcMain.handle("settings:save", async (_event, input) => publicSettings(await saveSettings(input ?? {})));
  ipcMain.handle("settings:test", async (_event, input) => {
    const saved = await saveSettings(input ?? {});
    if (saved.provider === "codex") {
      const result = await runProcess(findExecutable("codex"), ["login", "status"], { timeoutMs: 20_000 });
      if (result.code !== 0) throw new Error(result.stderr.trim() || "Codex 未登录");
      return { ok: true, message: result.stdout.trim() || result.stderr.trim() };
    }
    await sendWithCustomProvider({ prompt: "Reply with OK", model: saved.model, reasoning: "low" });
    return { ok: true, message: "连接成功" };
  });

  ipcMain.handle("auth:status", async () => {
    return await loadCodexAccount();
  });
  ipcMain.handle("auth:login", async () => {
    const child = spawn(findExecutable("codex"), ["login", "--device-auth"], { detached: true, stdio: "ignore" });
    child.unref();
    return { started: true };
  });
  ipcMain.handle("auth:logout", async () => {
    const result = await runProcess(findExecutable("codex"), ["logout"], { timeoutMs: 20_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "退出登录失败");
    return { connected: false };
  });
  ipcMain.handle("models:list", async () => await loadCodexModels());

  ipcMain.handle("projects:list", async () => await loadWorkspace());
  ipcMain.handle("projects:default-parent", async () => {
    const path = join(app.getPath("documents"), "Rux Projects");
    await mkdir(path, { recursive: true });
    return path;
  });
  ipcMain.handle("projects:choose-directory", async () => {
    const window = getWindow();
    const options = { properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("projects:import", async (_event, input: { path: string; createThread?: boolean }) => {
    const path = resolve(String(input?.path ?? ""));
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error("请选择项目文件夹");
    const workspace = await loadWorkspace();
    let project = workspace.projects.find((item) => item.path === path);
    if (!project) {
      project = { id: randomUUID(), name: basename(path), path, threads: input?.createThread === false ? [] : [{ id: randomUUID(), title: "项目会话" }] };
      workspace.projects.push(project);
      await saveWorkspace(workspace);
    }
    return project;
  });
  ipcMain.handle("projects:clone", async (_event, input: { url: string; parent: string; createThread?: boolean }) => {
    const url = String(input?.url ?? "").trim();
    if (!/^(https?:\/\/|git@)/.test(url)) throw new Error("Git 地址无效");
    const parent = resolve(String(input?.parent ?? ""));
    await mkdir(parent, { recursive: true });
    const result = await runProcess(findExecutable("git"), ["clone", "--", url], { cwd: parent, timeoutMs: 10 * 60_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "克隆失败");
    const folder = basename(url.replace(/\.git$/, ""));
    const path = join(parent, folder);
    const workspace = await loadWorkspace();
    const project = { id: randomUUID(), name: folder, path, threads: input.createThread === false ? [] : [{ id: randomUUID(), title: "项目会话" }] };
    workspace.projects.push(project);
    await saveWorkspace(workspace);
    return project;
  });
  ipcMain.handle("projects:create", async (_event, input: { name: string; parent: string; template: string; initGit: boolean; createThread?: boolean }) => {
    const name = validateProjectName(String(input?.name ?? ""));
    const parent = resolve(String(input?.parent ?? ""));
    if (!isAbsolute(parent)) throw new Error("保存位置无效");
    await mkdir(parent, { recursive: true });
    const path = join(parent, name);
    if (await pathExists(path)) throw new Error("同名项目已存在");
    await mkdir(path, { recursive: false });
    await ensureProjectTemplate(path, String(input?.template ?? "empty"), name);
    if (input?.initGit) await runGit(path, ["init"]);
    const workspace = await loadWorkspace();
    const project = { id: randomUUID(), name, path, threads: input.createThread === false ? [] : [{ id: randomUUID(), title: "项目会话" }] };
    workspace.projects.push(project);
    await saveWorkspace(workspace);
    return project;
  });
  ipcMain.handle("projects:remove", async (_event, projectId: string) => {
    const workspace = await loadWorkspace();
    const index = workspace.projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new Error("项目不存在");
    const [project] = workspace.projects.splice(index, 1);
    await saveWorkspace(workspace);
    return { project, workspace };
  });
  ipcMain.handle("projects:add-thread", async (_event, input: { projectId: string; title?: string }) => {
    const workspace = await loadWorkspace();
    const project = workspace.projects.find((item) => item.id === input.projectId);
    if (!project) throw new Error("项目不存在");
    const thread = { id: randomUUID(), title: String(input.title || "未命名会话").slice(0, 100) };
    project.threads.push(thread);
    await saveWorkspace(workspace);
    return thread;
  });
  ipcMain.handle("projects:add-standalone", async (_event, input: { title?: string }) => {
    const workspace = await loadWorkspace();
    const thread = { id: randomUUID(), title: String(input?.title || "未命名会话").slice(0, 100) };
    workspace.standaloneThreads.push(thread);
    await saveWorkspace(workspace);
    return thread;
  });
  ipcMain.handle("projects:update-thread", async (_event, input: { projectId: string; threadId: string; codexThreadId?: string; title?: string }) => {
    const workspace = await loadWorkspace();
    const project = workspace.projects.find((item) => item.id === input.projectId);
    const thread = project?.threads.find((item) => item.id === input.threadId);
    if (!thread) throw new Error("会话不存在");
    if (input.codexThreadId) thread.codexThreadId = input.codexThreadId;
    if (input.title) thread.title = input.title.slice(0, 100);
    await saveWorkspace(workspace);
    return thread;
  });
  ipcMain.handle("threads:update", async (_event, input: { type: "project" | "standalone"; projectId?: string; threadId: string; codexThreadId?: string; title?: string }) => {
    const workspace = await loadWorkspace();
    const thread = input.type === "project"
      ? workspace.projects.find((item) => item.id === input.projectId)?.threads.find((item) => item.id === input.threadId)
      : workspace.standaloneThreads.find((item) => item.id === input.threadId);
    if (!thread) throw new Error("会话不存在");
    if (input.codexThreadId) thread.codexThreadId = input.codexThreadId;
    if (input.title) thread.title = input.title.slice(0, 100);
    await saveWorkspace(workspace);
    return thread;
  });
  ipcMain.handle("threads:remove", async (_event, input: { type: "project" | "standalone"; projectId?: string; threadId: string }) => {
    const workspace = await loadWorkspace();
    const threads = input.type === "project"
      ? workspace.projects.find((project) => project.id === input.projectId)?.threads
      : workspace.standaloneThreads;
    if (!threads) throw new Error("会话不存在");
    const index = threads.findIndex((thread) => thread.id === input.threadId);
    if (index < 0) throw new Error("会话不存在");
    const [thread] = threads.splice(index, 1);
    await saveWorkspace(workspace);
    return { thread, workspace };
  });

  ipcMain.handle("agent:send", async (_event, input) => {
    const settings = await loadSettings();
    if (settings.provider === "custom") return await sendWithCustomProvider(input);
    return await sendWithCodex(input);
  });

  ipcMain.handle("git:status", async (_event, projectId: string) => await gitStatus(projectId));
  ipcMain.handle("git:diff", async (_event, input: { projectId: string; path: string }) => await gitDiff(input.projectId, input.path));
  ipcMain.handle("files:list", async (_event, projectId: string) => await listProjectFiles(projectId));
  ipcMain.handle("files:open", async (_event, input: { projectId: string; path: string }) => {
    const project = await resolveProject(input.projectId);
    const absolute = resolve(project.path, String(input.path ?? ""));
    if (!absolute.startsWith(`${project.path}/`)) throw new Error("文件路径越界");
    const error = await shell.openPath(absolute);
    if (error) throw new Error(error);
    return { opened: true };
  });
  ipcMain.handle("git:branches", async (_event, projectId: string) => {
    const project = await resolveProject(projectId);
    try {
      const output = await runGit(project.path, ["branch", "--format=%(refname:short)"]);
      return output.split(/\r?\n/).filter(Boolean);
    } catch { return []; }
  });
  ipcMain.handle("git:switch", async (_event, input: { projectId: string; branch: string }) => {
    const project = await resolveProject(input.projectId);
    const branches = (await runGit(project.path, ["branch", "--format=%(refname:short)"])).split(/\r?\n/).filter(Boolean);
    if (!branches.includes(input.branch)) throw new Error("分支不存在");
    await runGit(project.path, ["switch", input.branch]);
    return await gitStatus(input.projectId);
  });
  ipcMain.handle("git:remote", async (_event, projectId: string) => {
    const project = await resolveProject(projectId);
    try { return (await runGit(project.path, ["remote", "get-url", "origin"])).trim(); } catch { return ""; }
  });
  ipcMain.handle("git:commit-push", async (_event, input: { projectId: string; message: string; push: boolean }) => {
    const project = await resolveProject(input.projectId);
    const message = String(input.message ?? "").trim();
    if (message) {
      const staged = await runProcess(findExecutable("git"), ["diff", "--cached", "--quiet"], { cwd: project.path, timeoutMs: 30_000 });
      if (staged.code === 0) throw new Error("没有已暂存的变更，请先在审查页暂存文件");
      await runGit(project.path, ["commit", "-m", message]);
    }
    if (input.push) {
      const remote = (await runGit(project.path, ["remote", "get-url", "origin"])).trim();
      if (!remote) throw new Error("当前项目没有 origin 远程仓库");
      const branch = (await runGit(project.path, ["branch", "--show-current"])).trim();
      if (!branch) throw new Error("当前不在可推送的本地分支上");
      await runGit(project.path, ["push", "-u", "origin", branch]);
    }
    return await gitStatus(input.projectId);
  });
  ipcMain.handle("git:stage", async (_event, input: { projectId: string; paths: string[] }) => {
    const project = await resolveProject(input.projectId);
    const allowed = (await gitStatus(input.projectId)).files.map((item) => item.path);
    const paths = input.paths.filter((path) => allowed.includes(path));
    if (!paths.length) throw new Error("没有可暂存的文件");
    await runGit(project.path, ["add", "--", ...paths]);
    return await gitStatus(input.projectId);
  });
  ipcMain.handle("git:discard", async (_event, input: { projectId: string; path: string }) => {
    const project = await resolveProject(input.projectId);
    const status = await gitStatus(input.projectId);
    const file = status.files.find((item) => item.path === input.path);
    if (!file) throw new Error("变更不存在");
    if (file.untracked) throw new Error("为避免数据丢失，未跟踪文件不会自动删除");
    await runGit(project.path, ["restore", "--staged", "--worktree", "--", input.path]);
    return await gitStatus(input.projectId);
  });

  ipcMain.handle("terminal:start", async (event, projectId: string) => {
    const project = await resolveProject(projectId);
    const senderId = event.sender.id;
    terminalProcesses.get(senderId)?.kill("SIGTERM");
    const shellPath = process.env.SHELL || "/bin/zsh";
    const child = spawn(shellPath, ["-l"], { cwd: project.path, env: { ...process.env, TERM: "xterm-256color" }, stdio: ["pipe", "pipe", "pipe"] });
    terminalProcesses.set(senderId, child);
    const send = (data: string) => event.sender.send("terminal:data", data);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", send);
    child.stderr.on("data", send);
    child.on("close", (code) => {
      send(`\n[进程已退出：${code ?? 1}]\n`);
      terminalProcesses.delete(senderId);
    });
    child.stdin.write("pwd\n");
    return { started: true, cwd: project.path };
  });
  ipcMain.handle("terminal:write", async (event, input: string) => {
    const process = terminalProcesses.get(event.sender.id);
    if (!process || process.killed) throw new Error("终端未启动");
    process.stdin.write(`${input}\n`);
    return { written: true };
  });
  ipcMain.handle("terminal:stop", async (event) => {
    terminalProcesses.get(event.sender.id)?.kill("SIGTERM");
    terminalProcesses.delete(event.sender.id);
    return { stopped: true };
  });

  ipcMain.handle("system:open-path", async (_event, projectId: string) => {
    const project = await resolveProject(projectId);
    const error = await shell.openPath(project.path);
    if (error) throw new Error(error);
    return { opened: true };
  });
  ipcMain.handle("system:choose-files", async () => {
    const window = getWindow();
    const options = { properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections"> };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("system:copy", async (_event, value: string) => {
    clipboard.writeText(String(value ?? ""));
    return { copied: true };
  });
  ipcMain.handle("system:open-external", async (_event, url: string) => {
    const value = String(url ?? "").trim();
    if (!/^https?:\/\//.test(value)) throw new Error("仅支持 HTTP(S) 地址");
    await shell.openExternal(value);
    return { opened: true };
  });
  ipcMain.handle("system:info", async () => {
    const codex = await runProcess(findExecutable("codex"), ["--version"], { timeoutMs: 20_000 });
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      codexVersion: (codex.stdout || codex.stderr).trim(),
      codexPath: findExecutable("codex"),
    };
  });
}

export function stopBackendProcesses(): void {
  for (const child of terminalProcesses.values()) child.kill("SIGTERM");
  terminalProcesses.clear();
}
