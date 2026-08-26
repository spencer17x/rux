import { app, type BrowserWindow, ipcMain as electronIpcMain } from "electron";
import { join } from "node:path";
import { AgentSendService } from "./agent-send-service";
import { registerAgentRuntimeIpc } from "./agent-runtime-ipc";
import { ClaudeCodeClient } from "./agents/claude-code";
import { CodexAppServerClient } from "./agents/codex-app-server";
import { PiRuntimeClient } from "./agents/pi-runtime";
import { CodexCatalogClient } from "./codex-catalog-client";
import { registerGitIpc } from "./git-ipc";
import { GitService } from "./git-service";
import type { IpcRegistrar } from "./ipc-types";
import { runProcess } from "./process-runner";
import { ProviderProfileStore } from "./provider-profiles";
import { RuntimeManager } from "./runtime-manager";
import { SettingsAuthModelsIpc } from "./settings-auth-models-ipc";
import { SettingsStore } from "./settings-store";
import { StateDatabase } from "./state-database";
import { TerminalManager } from "./terminal-manager";
import { registerTerminalSystemIpc } from "./terminal-system-ipc";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { WorkspaceStore } from "./workspace-store";

let codexClient: CodexAppServerClient | null = null;
let claudeClient: ClaudeCodeClient | null = null;
let piClient: PiRuntimeClient | null = null;
let runtimeManager: RuntimeManager | null = null;
let providerStore: ProviderProfileStore | null = null;
let settingsAuthModels: SettingsAuthModelsIpc | null = null;
let terminalManager: TerminalManager | null = null;
let stateDatabase: StateDatabase | null = null;

export function registerBackend(getWindow: () => BrowserWindow | null): void {
  const ipc: IpcRegistrar = {
    handle(channel, listener) {
      electronIpcMain.handle(channel, async (event, ...args) => {
        const window = getWindow();
        if (!window || event.sender.id !== window.webContents.id) throw new Error("IPC 请求来源未授权");
        return await listener(event, ...args);
      });
    },
  };

  const userData = app.getPath("userData");
  stateDatabase = new StateDatabase(join(userData, "rux.sqlite"));
  const workspaceStore = new WorkspaceStore(stateDatabase, join(userData, "workspace.json"));
  const settingsStore = new SettingsStore(join(userData, "settings.json"));
  runtimeManager = new RuntimeManager(join(userData, "runtimes"), getWindow);
  providerStore = new ProviderProfileStore(join(userData, "provider-profiles.json"));
  const executable = (name: "codex" | "git") => name === "codex"
    ? runtimeManager!.resolveInstalled("codex").command
    : [process.env.GIT_BIN, "/usr/bin/git", "/opt/homebrew/bin/git", "git"].find(Boolean) as string;
  const emitAgentEvent = (event: any) => getWindow()?.webContents.send("agent:event", event);

  codexClient = new CodexAppServerClient(() => executable("codex"), emitAgentEvent);
  claudeClient = new ClaudeCodeClient(() => runtimeManager!.resolveInstalled("claude-code").command, emitAgentEvent);
  piClient = new PiRuntimeClient(() => runtimeManager!.resolveInstalled("pi"), emitAgentEvent);

  const catalog = new CodexCatalogClient(runtimeManager, () => executable("codex"), runProcess);
  const sendService = new AgentSendService(settingsStore, workspaceStore, runProcess, () => executable("codex"), () => executable("git"), userData);
  settingsAuthModels = new SettingsAuthModelsIpc({
    getWindow,
    runtimeManager,
    providerStore,
    claudeClient,
    piClient,
    resolveProject: (id) => workspaceStore.resolve(id),
    settingsStore,
    runProcess,
    codexExecutable: () => executable("codex"),
    loadCodexModels: () => catalog.models(),
    loadCodexAccount: () => catalog.account(),
    testCustomProvider: async (settings) => { await sendService.custom({ prompt: "Reply with OK", model: settings.model, reasoning: "low" }, settings); },
  });
  settingsAuthModels.register(ipc);

  registerWorkspaceIpc(ipc, {
    getWindow,
    loadWorkspace: () => workspaceStore.load(),
    saveWorkspace: (workspace) => workspaceStore.save(workspace),
    stateDatabase: () => stateDatabase!,
    runProcess,
    gitExecutable: () => executable("git"),
  });
  registerAgentRuntimeIpc(ipc, {
    getWindow,
    settingsStore,
    runtimeManager,
    providerStore,
    codexClient,
    claudeClient,
    piClient,
    resolveProject: (id) => workspaceStore.resolve(id),
    sendWithCodex: (input) => sendService.codex(input),
    sendWithCustomProvider: (input, settings) => sendService.custom(input, settings),
  });
  const runGit = async (path: string, args: string[]) => {
    const result = await runProcess(executable("git"), args, { cwd: path, timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "Git 操作失败");
    return result.stdout;
  };
  registerGitIpc(ipc, new GitService((id) => workspaceStore.resolve(id), runGit, runProcess, () => executable("git")));
  terminalManager = new TerminalManager();
  registerTerminalSystemIpc(ipc, { getWindow, resolveProject: (id) => workspaceStore.resolve(id), terminalManager, codexStatus: () => runtimeManager!.status("codex") });
}

export function stopBackendProcesses(): void {
  settingsAuthModels?.stop(); settingsAuthModels = null;
  codexClient?.stop(); codexClient = null;
  claudeClient?.stop(); claudeClient = null;
  piClient?.stop(); piClient = null;
  terminalManager?.stopAll(); terminalManager = null;
  stateDatabase?.close(); stateDatabase = null;
  providerStore = null;
  runtimeManager = null;
}
