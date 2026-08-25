import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

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
    standaloneThreads: [
      { id: "compare", title: "比较模型响应" },
      { id: "logs", title: "解释错误日志" },
    ],
  };
  const workspace = await readJson(userDataFile("workspace.json"), fallback);

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

async function loadCodexModels(): Promise<{ models: CodexModel[] }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(findExecutable("codex"), ["app-server", "--stdio"], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;

    const finish = (error?: Error, models?: CodexModel[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolvePromise({ models: models ?? [] });
    };

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const handleLine = (line: string) => {
      if (!line.trim().startsWith("{")) return;
      try {
        const message = JSON.parse(line) as {
          id?: number;
          error?: { message?: string };
          result?: { data?: CodexModel[] };
        };
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "model/list", params: { includeHidden: false, limit: 100 } });
        }
        if (message.id === 2) {
          if (message.error) finish(new Error(message.error.message || "无法读取 Codex 模型"));
          else finish(undefined, (message.result?.data ?? []).filter((model) => !model.hidden));
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
      if (!settled) finish(new Error(`Codex 模型服务已退出（${code ?? 1}）`));
    });
    const timeout = setTimeout(() => finish(new Error("读取 Codex 模型超时")), 20_000);
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "rux", title: "Rux", version: app.getVersion() }, capabilities: {} },
    });
  });
}

async function runGit(projectPath: string, args: string[]): Promise<string> {
  const result = await runProcess(findExecutable("git"), args, { cwd: projectPath, timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Git 操作失败");
  return result.stdout;
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
  threadId?: string;
}): Promise<{ text: string; threadId?: string; diagnostics: string }> {
  const project = input.projectId ? await resolveProject(input.projectId) : null;
  const cwd = project?.path ?? join(app.getPath("userData"), "standalone-workspace");
  await mkdir(cwd, { recursive: true });
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("消息不能为空");
  const codex = findExecutable("codex");
  const settings = await loadSettings();
  const model = (input.model ?? settings.model).trim();
  const reasoning = input.reasoning ?? settings.reasoning;
  const args = input.threadId
    ? ["exec", "resume", "--json"]
    : ["exec", "--json", "-s", "workspace-write", "-C", cwd];
  if (!project && !input.threadId) args.push("--skip-git-repo-check");
  if (model && model !== "default") args.push("-m", model);
  args.push("-c", `model_reasoning_effort=\"${reasoning}\"`);
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
    const files = porcelain.split(/\r?\n/).filter(Boolean).map((line) => {
      const statusCode = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()! : rawPath;
      const count = counts.get(filePath) ?? { plus: 0, minus: 0 };
      return { path: filePath, status: statusCode, untracked: statusCode === "??", ...count };
    });
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
    return (await readFile(absolute, "utf8")).split("\n").map((line) => `+ ${line}`).join("\n");
  }
  const staged = await runGit(project.path, ["diff", "--cached", "--", filePath]);
  const unstaged = await runGit(project.path, ["diff", "--", filePath]);
  return [staged, unstaged].filter(Boolean).join("\n");
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
    const result = await runProcess(findExecutable("codex"), ["login", "status"], { timeoutMs: 20_000 });
    return { connected: result.code === 0, message: (result.stdout || result.stderr).trim() };
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
  ipcMain.handle("projects:import", async (_event, input: { path: string }) => {
    const path = resolve(String(input?.path ?? ""));
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error("请选择项目文件夹");
    const workspace = await loadWorkspace();
    let project = workspace.projects.find((item) => item.path === path);
    if (!project) {
      project = { id: randomUUID(), name: basename(path), path, threads: [{ id: randomUUID(), title: "项目会话" }] };
      workspace.projects.push(project);
      await saveWorkspace(workspace);
    }
    return project;
  });
  ipcMain.handle("projects:clone", async (_event, input: { url: string; parent: string }) => {
    const url = String(input?.url ?? "").trim();
    if (!/^(https?:\/\/|git@)/.test(url)) throw new Error("Git 地址无效");
    const parent = resolve(String(input?.parent ?? ""));
    await mkdir(parent, { recursive: true });
    const result = await runProcess(findExecutable("git"), ["clone", "--", url], { cwd: parent, timeoutMs: 10 * 60_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "克隆失败");
    const folder = basename(url.replace(/\.git$/, ""));
    const path = join(parent, folder);
    const workspace = await loadWorkspace();
    const project = { id: randomUUID(), name: folder, path, threads: [{ id: randomUUID(), title: "项目会话" }] };
    workspace.projects.push(project);
    await saveWorkspace(workspace);
    return project;
  });
  ipcMain.handle("projects:create", async (_event, input: { name: string; parent: string; template: string; initGit: boolean }) => {
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
    const project = { id: randomUUID(), name, path, threads: [{ id: randomUUID(), title: "项目会话" }] };
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

  ipcMain.handle("agent:send", async (_event, input) => {
    const settings = await loadSettings();
    if (settings.provider === "custom") return await sendWithCustomProvider(input);
    return await sendWithCodex(input);
  });

  ipcMain.handle("git:status", async (_event, projectId: string) => await gitStatus(projectId));
  ipcMain.handle("git:diff", async (_event, input: { projectId: string; path: string }) => await gitDiff(input.projectId, input.path));
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
}

export function stopBackendProcesses(): void {
  for (const child of terminalProcesses.values()) child.kill("SIGTERM");
  terminalProcesses.clear();
}
