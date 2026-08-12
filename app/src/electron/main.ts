import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  MessageChannelMain,
  type MessagePortMain,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import runtimePath from "./runtime?modulePath";
import { AgentProfileStore } from "./agent-profile-store";
import { TaskStore } from "./task-store";
import {
  IPC_CHANNELS,
  runtimeRequestSchema,
  taskStateLoadParamsSchema,
  workspaceActivateParamsSchema,
  workspaceOpenParamsSchema,
  workspaceTaskStateSchema,
  type DesktopInfo,
  type RuntimeEvent,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeWireMessage,
  type WorkspaceState,
  type WorkspaceOpenResult,
  type WorkspaceSummary,
  type WorkspaceTaskState,
} from "../shared/protocol";
import { failClosedTimeout, runtimeRequestPolicy } from "./runtime-request-policy.ts";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

const RUNTIME_SHUTDOWN_TIMEOUT_MS = 8_000;
const RUNTIME_EXIT_TIMEOUT_MS = 1_500;
const RUNTIME_SIGTERM_EXIT_TIMEOUT_MS = 4_000;
const RUNTIME_SIGKILL_EXIT_TIMEOUT_MS = 1_000;
const WORKSPACE_STATE_VERSION = 2;

type WorkspaceAuthorizationSource = "placeholder" | "picker" | "environment" | "legacy-restored" | "legacy-ambiguous";
type StoredWorkspaceState = Partial<WorkspaceState> & {
  version?: number;
  authorizationSource?: WorkspaceAuthorizationSource;
};

let mainWindow: BrowserWindow | null = null;
let runtimeProcess: UtilityProcess | null = null;
let runtimePort: MessagePortMain | null = null;
let workspaceState: WorkspaceState | null = null;
let workspaceAuthorizationSource: WorkspaceAuthorizationSource = "placeholder";
let taskStore: TaskStore | null = null;
let agentProfileStore: AgentProfileStore | null = null;
let runtimeStopPromise: Promise<void> | null = null;
let workspaceTransition: Promise<void> = Promise.resolve();
let quitCleanupStarted = false;
let allowQuit = false;
const pendingRequests = new Map<string, PendingRequest>();
const runtimeExitPromises = new WeakMap<UtilityProcess, Promise<number>>();

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const window = mainWindow;
  if (
    !window
    || window.isDestroyed()
    || window.webContents.isDestroyed()
    || event.sender !== window.webContents
    || event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error("Rejected IPC request from an untrusted Renderer frame");
  }
}

function gitValue(workspacePath: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", workspacePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function defaultWorkspacePath(): string {
  const welcomePlaceholder = resolve(app.getPath("userData"), "welcome-workspace");
  if (!process.env.RUX_WORKSPACE_ROOT) mkdirSync(welcomePlaceholder, { recursive: true });
  const configured = resolve(process.env.RUX_WORKSPACE_ROOT ?? welcomePlaceholder);
  return gitValue(configured, ["rev-parse", "--show-toplevel"]) ?? configured;
}

function legacyDevelopmentWorkspacePath(): string | undefined {
  if (app.isPackaged || process.env.RUX_WORKSPACE_ROOT) return undefined;
  try {
    const developmentRoot = realpathSync(resolve(import.meta.dirname, "../.."));
    const repositoryRoot = gitValue(developmentRoot, ["rev-parse", "--show-toplevel"]);
    return realpathSync(resolve(repositoryRoot ?? developmentRoot));
  } catch {
    return undefined;
  }
}

function inspectWorkspace(inputPath: string, lastOpenedAt = new Date().toISOString()): WorkspaceSummary {
  const workspacePath = realpathSync(resolve(inputPath));
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    throw new Error(`Workspace does not exist: ${workspacePath}`);
  }

  const placeholderPath = resolve(app.getPath("userData"), "welcome-workspace");
  const placeholder = workspacePath === placeholderPath;
  return {
    id: createHash("sha256").update(workspacePath).digest("hex").slice(0, 12),
    name: placeholder ? "选择项目" : basename(workspacePath) || workspacePath,
    path: workspacePath,
    branch: gitValue(workspacePath, ["branch", "--show-current"]) ?? "—",
    lastOpenedAt,
    ...(placeholder ? { placeholder: true } : {}),
  };
}

function workspaceStatePath(): string {
  return resolve(app.getPath("userData"), "workspace-state.json");
}

function persistWorkspaceState(): void {
  if (!workspaceState) return;
  const target = workspaceStatePath();
  const temporary = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  const stored: StoredWorkspaceState = {
    version: WORKSPACE_STATE_VERSION,
    authorizationSource: workspaceAuthorizationSource,
    ...workspaceState,
  };
  writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  renameSync(temporary, target);
}

function initializeWorkspaceState(): void {
  let stored: StoredWorkspaceState | undefined;
  try {
    stored = JSON.parse(readFileSync(workspaceStatePath(), "utf8")) as StoredWorkspaceState;
  } catch {
    stored = undefined;
  }

  const fallback = inspectWorkspace(defaultWorkspacePath());
  const recent: WorkspaceSummary[] = [];
  const storedRecent = Array.isArray(stored?.recent) ? stored.recent : [];

  for (const item of storedRecent) {
    if (!item || typeof item.path !== "string") continue;
    try {
      const inspected = inspectWorkspace(item.path, item.lastOpenedAt);
      if (!recent.some((workspace) => workspace.path === inspected.path)) recent.push(inspected);
    } catch {
      // Ignore workspaces that have moved or no longer exist.
    }
  }

  let storedActive: WorkspaceSummary | undefined;
  if (stored?.active && typeof stored.active.path === "string") {
    try {
      storedActive = inspectWorkspace(stored.active.path, new Date().toISOString());
    } catch {
      storedActive = undefined;
    }
  }

  const legacyDevelopmentPath = legacyDevelopmentWorkspacePath();
  const legacyDevelopmentActivation = Boolean(
    storedActive
    && !stored?.authorizationSource
    && legacyDevelopmentPath
    && storedActive.path === legacyDevelopmentPath,
  );
  const environmentConfigured = Boolean(process.env.RUX_WORKSPACE_ROOT);
  let active = fallback;
  if (environmentConfigured) {
    workspaceAuthorizationSource = "environment";
  } else if (
    storedActive
    && !legacyDevelopmentActivation
    && stored?.authorizationSource !== "environment"
    && stored?.authorizationSource !== "legacy-ambiguous"
  ) {
    active = storedActive;
    workspaceAuthorizationSource = stored?.authorizationSource ?? "legacy-restored";
  } else if (legacyDevelopmentActivation && storedActive) {
    workspaceAuthorizationSource = "legacy-ambiguous";
    if (!recent.some((workspace) => workspace.path === storedActive.path)) recent.unshift(storedActive);
  } else {
    workspaceAuthorizationSource = "placeholder";
  }

  workspaceState = {
    active,
    recent: [active, ...recent.filter((workspace) => workspace.path !== active.path && !workspace.placeholder)].slice(0, 8),
  };
  persistWorkspaceState();
}

function requireWorkspaceState(): WorkspaceState {
  if (!workspaceState) throw new Error("Rux workspace state is unavailable");
  return workspaceState;
}

function requireTaskStore(): TaskStore {
  if (!taskStore) throw new Error("Rux task store is unavailable");
  return taskStore;
}

function requireAuthorizedWorkspaceId(workspaceId?: string): string {
  const state = requireWorkspaceState();
  const requestedId = workspaceId ?? state.active.id;
  if (!state.recent.some((workspace) => workspace.id === requestedId)) {
    throw new Error("Task state may only be accessed for an authorized workspace");
  }
  return requestedId;
}

function activateWorkspace(inputPath: string, allowNew: boolean): Promise<WorkspaceState> {
  const transition = workspaceTransition.catch(() => undefined).then(async () => {
    const current = requireWorkspaceState();
    const resolvedPath = realpathSync(resolve(inputPath));
    if (!allowNew && !current.recent.some((workspace) => workspace.path === resolvedPath)) {
      throw new Error("Workspace must be selected through the native folder picker first");
    }

    const active = inspectWorkspace(resolvedPath);
    await stopRuntimeProcess("workspace switch");
    const nextState: WorkspaceState = {
      active,
      recent: [active, ...current.recent.filter((workspace) => workspace.path !== active.path && !workspace.placeholder)].slice(0, 8),
    };
    workspaceState = nextState;
    workspaceAuthorizationSource = "picker";
    persistWorkspaceState();
    startRuntimeProcess();
    return nextState;
  });
  workspaceTransition = transition.then(() => undefined, () => undefined);
  return transition;
}

function emitToRenderers(event: RuntimeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    try {
      window.webContents.send(IPC_CHANNELS.event, event);
    } catch {
      // A concurrently disappearing Renderer must not interrupt fail-closed cleanup.
    }
  }
}

function rejectPendingRequests(message: string): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
    pendingRequests.delete(id);
  }
}

function holdPendingRequests(): PendingRequest[] {
  const held = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const pending of held) clearTimeout(pending.timeout);
  return held;
}

function rejectHeldRequests(held: PendingRequest[], message: string): void {
  for (const pending of held) pending.reject(new Error(message));
}

function observeRuntimeExit(child: UtilityProcess): Promise<number> {
  const existing = runtimeExitPromises.get(child);
  if (existing) return existing;
  const exit = new Promise<number>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code ?? -1));
  });
  runtimeExitPromises.set(child, exit);
  return exit;
}

async function waitForRuntimeExit(child: UtilityProcess, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
  });
  const exited = await Promise.race([
    observeRuntimeExit(child).then(() => true as const),
    timedOut,
  ]);
  if (timeout) clearTimeout(timeout);
  return exited;
}

function handleRuntimeMessage(message: RuntimeWireMessage): void {
  if (message.kind === "event") {
    emitToRenderers(message.event);
    return;
  }

  const pending = pendingRequests.get(message.id);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRequests.delete(message.id);

  if (message.ok) {
    pending.resolve(message.result);
  } else {
    pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
  }
}

function startRuntimeProcess(): void {
  if (runtimeProcess) return;

  const workspaceRoot = requireWorkspaceState().active.path;
  const { port1, port2 } = new MessageChannelMain();

  runtimePort = port2;
  runtimePort.on("message", (event) => {
    handleRuntimeMessage(event.data as RuntimeWireMessage);
  });
  runtimePort.on("close", () => {
    const wasActivePort = runtimePort === port2;
    if (wasActivePort) runtimePort = null;
    if (runtimeStopPromise) {
      rejectPendingRequests("Rux Runtime connection closed");
    } else if (wasActivePort && runtimeProcess) {
      void stopRuntimeProcess("Runtime connection closed");
    }
  });
  runtimePort.start();

  const child = utilityProcess.fork(runtimePath, [], {
    serviceName: "Rux Runtime",
    stdio: "pipe",
    env: {
      ...process.env,
      RUX_WORKSPACE_ROOT: workspaceRoot,
      RUX_STATE_ROOT: app.getPath("userData"),
      RUX_ENABLE_MOCK: app.isPackaged ? "0" : "1",
    },
  });
  runtimeProcess = child;
  void observeRuntimeExit(child);

  child.stdout?.on("data", (chunk) => {
    console.log(`[runtime] ${String(chunk).trimEnd()}`);
  });
  child.stderr?.on("data", (chunk) => {
    console.error(`[runtime] ${String(chunk).trimEnd()}`);
  });
  child.on("exit", (code) => {
    const exitCode = code ?? -1;
    const wasActiveProcess = runtimeProcess === child;
    if (wasActiveProcess) {
      runtimeProcess = null;
      if (runtimePort === port2) {
        runtimePort.close();
        runtimePort = null;
      }
      emitToRenderers({ type: "runtime.stopped", exitCode });
    }
    if (wasActiveProcess || runtimeStopPromise) {
      rejectPendingRequests(`Rux Runtime exited with code ${exitCode}`);
    }
  });

  child.postMessage({ kind: "connect" }, [port1]);
}

function requestRuntimeOnPort(
  port: MessagePortMain,
  request: RuntimeRequest,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.id);
      rejectRequest(new Error(`Rux Runtime request timed out: ${request.method}`));
    }, timeoutMs);
    pendingRequests.set(request.id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timeout,
    });
    try {
      port.postMessage(request);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(request.id);
      rejectRequest(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function performRuntimeStop(reason: string): Promise<void> {
  const child = runtimeProcess;
  const port = runtimePort;
  let exitCode = child ? -1 : 0;
  if (child) void observeRuntimeExit(child).then((code) => {
    exitCode = code;
  });
  runtimeProcess = null;
  runtimePort = null;
  const heldRequests = holdPendingRequests();

  try {
    if (port) {
      const request: RuntimeRequest<"runtime.shutdown"> = {
        kind: "request",
        id: `runtime-shutdown-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        method: "runtime.shutdown",
        params: { reason },
      };
      try {
        await requestRuntimeOnPort(port, request, RUNTIME_SHUTDOWN_TIMEOUT_MS);
      } catch (error) {
        console.error(`[runtime] Graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (child && !await waitForRuntimeExit(child, RUNTIME_EXIT_TIMEOUT_MS)) {
      child.kill();
      if (!await waitForRuntimeExit(child, RUNTIME_SIGTERM_EXIT_TIMEOUT_MS)) {
        try {
          if (child.pid) process.kill(child.pid, "SIGKILL");
          else child.kill();
        } catch {
          // The Utility Process exited between the wait and the force signal.
        }
        if (!await waitForRuntimeExit(child, RUNTIME_SIGKILL_EXIT_TIMEOUT_MS)) {
          console.error(`[runtime] Utility Process ${child.pid} did not report exit after SIGKILL`);
        }
      }
    }
  } finally {
    try {
      port?.close();
    } catch {
      // The Runtime already closed its side of the MessagePort.
    }
    rejectPendingRequests("Rux Runtime stopped");
    rejectHeldRequests(heldRequests, `Rux Runtime stopped: ${reason}`);
    if (child) emitToRenderers({ type: "runtime.stopped", exitCode });
  }
}

function stopRuntimeProcess(reason: string): Promise<void> {
  if (runtimeStopPromise) return runtimeStopPromise;
  const stopping = Promise.resolve().then(() => performRuntimeStop(reason));
  const tracked = stopping.finally(() => {
    if (runtimeStopPromise === tracked) runtimeStopPromise = null;
  });
  runtimeStopPromise = tracked;
  return tracked;
}

async function requestRuntime(request: RuntimeRequest): Promise<unknown> {
  await workspaceTransition;
  if (runtimeStopPromise) await runtimeStopPromise;
  if (!runtimePort || !runtimeProcess) {
    startRuntimeProcess();
  }
  if (!runtimePort) {
    return Promise.reject(new Error("Rux Runtime is unavailable"));
  }

  const port = runtimePort;
  if (!port) return Promise.reject(new Error("Rux Runtime is unavailable"));
  return new Promise((resolveRequest, rejectRequest) => {
    const policy = runtimeRequestPolicy(request.method);
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(request.id);
      if (!pending) return;
      pendingRequests.delete(request.id);
      if (policy.timeoutAction === "stop-runtime") {
        void failClosedTimeout(
          request.method,
          () => stopRuntimeProcess(`request timeout: ${request.method}`),
        ).catch(rejectRequest);
      } else {
        rejectRequest(new Error(`Rux Runtime request timed out: ${request.method}`));
      }
    }, policy.timeoutMs);

    pendingRequests.set(request.id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timeout,
    });
    try {
      port.postMessage(request);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(request.id);
      rejectRequest(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.desktopInfo, (event): DesktopInfo => {
    assertTrustedRenderer(event);
    return {
      platform: process.platform,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
    };
  });

  ipcMain.handle(IPC_CHANNELS.request, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = runtimeRequestSchema.parse(input) as RuntimeRequest;
    if (parsed.method === "runtime.shutdown") {
      throw new Error("Runtime shutdown is owned by the Main Process lifecycle");
    }
    return requestRuntime(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceState, (event): WorkspaceState => {
    assertTrustedRenderer(event);
    return requireWorkspaceState();
  });

  ipcMain.handle(IPC_CHANNELS.workspaceChoose, async (event): Promise<WorkspaceState | null> => {
    assertTrustedRenderer(event);
    const activeWorkspace = requireWorkspaceState().active;
    const options: Electron.OpenDialogOptions = {
      title: "选择 Rux 工作区",
      defaultPath: activeWorkspace.placeholder ? app.getPath("documents") : activeWorkspace.path,
      properties: ["openDirectory"],
      buttonLabel: "打开工作区",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return activateWorkspace(result.filePaths[0], true);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceActivate, async (event, input: unknown): Promise<WorkspaceState> => {
    assertTrustedRenderer(event);
    const parsed = workspaceActivateParamsSchema.parse(input);
    return activateWorkspace(parsed.path, false);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async (event, input: unknown): Promise<WorkspaceOpenResult> => {
    assertTrustedRenderer(event);
    const { target } = workspaceOpenParamsSchema.parse(input ?? {});
    const workspace = requireWorkspaceState().active;
    if (workspace.placeholder) return { opened: false, target, detail: "请先选择一个项目" };
    requireAuthorizedWorkspaceId(workspace.id);

    if (target === "finder") {
      const detail = await shell.openPath(workspace.path);
      return detail
        ? { opened: false, target: "finder", detail }
        : { opened: true, target: "finder" };
    }

    try {
      const workspaceUrl = pathToFileURL(workspace.path);
      await shell.openExternal(`vscode://file${workspaceUrl.pathname}`);
      return { opened: true, target: "vscode" };
    } catch {
      const finderDetail = await shell.openPath(workspace.path);
      return finderDetail
        ? { opened: false, target: "finder", detail: `VS Code 打开失败；Finder 回退失败：${finderDetail}` }
        : { opened: true, target: "finder", detail: "VS Code 打开失败，已回退到 Finder 显示项目目录。" };
    }
  });

  ipcMain.handle(IPC_CHANNELS.taskStateLoad, (event, input: unknown): WorkspaceTaskState => {
    assertTrustedRenderer(event);
    const parsed = taskStateLoadParamsSchema.parse(input ?? {});
    return requireTaskStore().load(requireAuthorizedWorkspaceId(parsed.workspaceId));
  });

  ipcMain.handle(IPC_CHANNELS.taskStateSave, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = workspaceTaskStateSchema.parse(input);
    requireAuthorizedWorkspaceId(parsed.workspaceId);
    const saved = requireTaskStore().save(parsed);
    return { workspaceId: saved.workspaceId, savedAt: saved.updatedAt };
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1433,
    height: 812,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#f5f5f2",
    title: "Rux",
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 17 },
        }
      : {}),
    webPreferences: {
      preload: resolve(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    void stopRuntimeProcess("window destroyed");
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    void stopRuntimeProcess(`renderer process gone: ${details.reason}`);
  });

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:") void shell.openExternal(target.toString());
    } catch {
      // Malformed and non-HTTPS targets stay inside the fail-closed boundary.
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url !== currentUrl) event.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(resolve(import.meta.dirname, "../renderer/index.html"));
  }

  return window;
}

// Keep the existing state directory stable across the visible RUX -> Rux rename,
// while preserving Electron's explicit --user-data-dir override for isolated QA.
const hasExplicitUserDataDirectory = process.argv.some(
  (argument) => argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
);
if (!hasExplicitUserDataDirectory) {
  app.setPath("userData", resolve(app.getPath("appData"), "RUX"));
}
app.setName("Rux");

app.whenReady().then(() => {
  initializeWorkspaceState();
  agentProfileStore = new AgentProfileStore(resolve(app.getPath("userData"), "agent-profiles.json"));
  taskStore = new TaskStore(
    resolve(app.getPath("userData"), "rux-task-state.sqlite3"),
    undefined,
    (revisionId) => agentProfileStore?.getRevision(revisionId),
  );
  registerIpcHandlers();
  startRuntimeProcess();
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  void stopRuntimeProcess("application quit").finally(() => {
    try {
      taskStore?.close();
      taskStore = null;
    } finally {
      allowQuit = true;
      app.quit();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
