import { app, type BrowserWindow } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { agentInterruptSchema, agentSendSchema, agentStartSchema, approvalSchema, parseInput } from "../shared/ipc";
import type { ClaudeCodeClient } from "./agents/claude-code";
import type { CodexAppServerClient } from "./agents/codex-app-server";
import type { PiRuntimeClient } from "./agents/pi-runtime";
import type { ProviderProfileStore } from "./provider-profiles";
import type { RuntimeManager } from "./runtime-manager";
import type { IpcRegistrar, ResolveProject } from "./ipc-types";
import type { RuxSettings, SettingsStore } from "./settings-store";

type Dependencies = { getWindow: () => BrowserWindow | null; settingsStore: SettingsStore; runtimeManager: RuntimeManager; providerStore: ProviderProfileStore; codexClient: CodexAppServerClient; claudeClient: ClaudeCodeClient; piClient: PiRuntimeClient; resolveProject: ResolveProject; sendWithCodex: (input: any) => Promise<any>; sendWithCustomProvider: (input: any, settings?: RuxSettings) => Promise<any> };

export function registerAgentRuntimeIpc(ipc: IpcRegistrar, deps: Dependencies): void {
  ipc.handle("agent:send", async (_event, value) => { const input = parseInput(agentSendSchema, value); if (process.env.RUX_E2E === "1") { await new Promise((resolve) => setTimeout(resolve, 250)); return { text: "RUX_E2E_SIDE_OK", threadId: "e2e-side-thread" }; } const settings = await deps.settingsStore.load(); return settings.provider === "custom" ? await deps.sendWithCustomProvider(input) : await deps.sendWithCodex(input); });
  ipc.handle("agent:start", async (_event, value) => {
    const input = parseInput(agentStartSchema, value); const settings = await deps.settingsStore.load();
    if (process.env.RUX_E2E === "1") { queueMicrotask(() => { const window = deps.getWindow(); window?.webContents.send("agent:event", { runId: input.runId, type: "text-delta", itemId: `text-${input.runId}`, delta: "RUX_E2E_AGENT_OK" }); window?.webContents.send("agent:event", { runId: input.runId, type: "turn-completed", status: "completed" }); }); return { runId: input.runId, threadId: "e2e-thread", turnId: "e2e-turn" }; }
    if (settings.provider === "custom" && (!input.agentId || input.agentId === "codex")) { const result = await deps.sendWithCustomProvider(input); queueMicrotask(() => { const window = deps.getWindow(); window?.webContents.send("agent:event", { runId: input.runId, type: "text-delta", itemId: `text-${input.runId}`, delta: result.text }); window?.webContents.send("agent:event", { runId: input.runId, type: "turn-completed", status: "completed" }); }); return { runId: input.runId, threadId: input.threadId || "" }; }
    const project = input.projectId ? await deps.resolveProject(input.projectId) : null; const cwd = project?.path ?? join(app.getPath("userData"), "standalone-workspace"); await mkdir(cwd, { recursive: true });
    if (input.agentId === "claude-code") { await deps.runtimeManager.ensure("claude-code"); return deps.claudeClient.startTurn({ runId: input.runId, sessionId: input.nativeSessionId || input.threadId, cwd, prompt: input.prompt.trim(), model: input.model, reasoning: input.reasoning || settings.reasoning, mode: input.mode }); }
    if (input.agentId === "pi") { await deps.runtimeManager.ensure("pi"); const runtime = await deps.providerStore.materializePiRuntime(join(app.getPath("userData"), "agents", "pi")); if (!runtime) throw new Error("请先配置一个兼容 Pi 的 Provider"); return await deps.piClient.startTurn({ runId: input.runId, sessionFile: input.nativeSessionId || input.threadId, cwd, prompt: input.prompt.trim(), model: input.model, reasoning: input.reasoning || settings.reasoning, mode: input.mode, runtime }); }
    await deps.runtimeManager.ensure("codex"); return await deps.codexClient.startTurn({ runId: input.runId, threadId: input.threadId, cwd, prompt: input.prompt.trim(), model: input.model || settings.model, reasoning: input.reasoning || settings.reasoning, sandboxMode: input.sandboxMode || settings.sandboxMode, images: input.images, webSearch: input.webSearch, mode: input.mode === "plan" ? "plan" : "default" });
  });
  ipc.handle("agent:interrupt", async (_event, value) => { const input = parseInput(agentInterruptSchema, value); if (input.agentId === "claude-code") await deps.claudeClient.interrupt(String(input.runId || input.turnId)); else if (input.agentId === "pi") await deps.piClient.interrupt(String(input.runId || input.turnId)); else await deps.codexClient.interrupt(input.threadId, input.turnId); return { interrupted: true }; });
  ipc.handle("agent:approval", async (_event, value) => { const input = parseInput(approvalSchema, value); if (input.approvalId.startsWith("claude:")) deps.claudeClient.respondToApproval(input.approvalId, input.decision); else deps.codexClient.respondToApproval(input.approvalId, input.decision); return { responded: true }; });
}
