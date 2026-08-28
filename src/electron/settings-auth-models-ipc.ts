import { app, type BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { agentIdSchema, modelListSchema, parseInput, providerSaveSchema, settingsInputSchema, threadIdSchema } from "../shared/ipc";
import type { ClaudeCodeClient } from "./agents/claude-code";
import type { PiRuntimeClient } from "./agents/pi-runtime";
import type { ProviderProfileStore } from "./provider-profiles";
import type { RuntimeAgentId, RuntimeManager } from "./runtime-manager";
import type { IpcRegistrar, ResolveProject, RunProcess } from "./ipc-types";
import type { RuxSettings, SettingsStore } from "./settings-store";

type Dependencies = { getWindow: () => BrowserWindow | null; runtimeManager: RuntimeManager; providerStore: ProviderProfileStore; claudeClient: ClaudeCodeClient; piClient: PiRuntimeClient; resolveProject: ResolveProject; settingsStore: SettingsStore; runProcess: RunProcess; codexExecutable: () => string; codexEnvironment: () => Record<string, string>; loadCodexModels: () => Promise<{ models: any[] }>; loadCodexAccount: () => Promise<any>; testCustomProvider: (settings: RuxSettings) => Promise<void> };

export class SettingsAuthModelsIpc {
  private authLoginProcess: ChildProcessWithoutNullStreams | null = null;
  constructor(private readonly deps: Dependencies) {}

  register(ipc: IpcRegistrar): void {
    const d = this.deps;
    ipc.handle("runtimes:list", async () => ({ runtimes: await d.runtimeManager.list() }));
    ipc.handle("runtimes:ensure", async (_event, value) => { const id = parseInput(agentIdSchema, value) as RuntimeAgentId; await d.runtimeManager.ensure(id); return await d.runtimeManager.status(id); });
    ipc.handle("settings:get", async () => d.settingsStore.public(await d.settingsStore.load()));
    ipc.handle("settings:save", async (_event, value) => d.settingsStore.public(await d.settingsStore.save(parseInput(settingsInputSchema, value ?? {}))));
    ipc.handle("settings:test", async (_event, value) => { const candidate = d.settingsStore.merge(await d.settingsStore.load(), parseInput(settingsInputSchema, value ?? {})); if (candidate.provider === "codex") { await d.runtimeManager.ensure("codex"); const result = await d.runProcess(d.codexExecutable(), ["login", "status"], { timeoutMs: 20_000, env: d.codexEnvironment() }); if (result.code !== 0) throw new Error(result.stderr.trim() || "Codex 未登录"); return { ok: true, message: result.stdout.trim() || result.stderr.trim() }; } await d.testCustomProvider(candidate); return { ok: true, message: "连接成功" }; });
    ipc.handle("providers:list", async () => await d.providerStore.list());
    ipc.handle("providers:save", async (_event, value) => await d.providerStore.save(parseInput(providerSaveSchema, value || {})));
    ipc.handle("providers:remove", async (_event, value) => await d.providerStore.remove(parseInput(threadIdSchema, value)));
    ipc.handle("providers:set-active", async (_event, value) => await d.providerStore.setActive(parseInput(threadIdSchema, value)));
    ipc.handle("providers:test", async (_event, value) => await d.providerStore.test(parseInput(threadIdSchema, value)));
    ipc.handle("auth:status", async () => { if (process.env.RUX_E2E === "1") return { connected: false, account: null, message: "E2E 模式" }; const runtime = await d.runtimeManager.status("codex"); if (!runtime.installed) return { connected: false, runtimeRequired: true, account: null, message: "Codex 将在首次使用时自动下载" }; return await d.loadCodexAccount(); });
    ipc.handle("auth:login", async () => { await d.runtimeManager.ensure("codex"); if (this.authLoginProcess && !this.authLoginProcess.killed) return { started: true, alreadyRunning: true }; const child = spawn(d.codexExecutable(), ["login", "--device-auth"], { env: { ...process.env, ...d.codexEnvironment(), NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] }); this.authLoginProcess = child; child.stdin.end(); const emit = (event: Record<string, unknown>) => d.getWindow()?.webContents.send("auth:login-event", event); const output = (chunk: Buffer | string) => { const text = String(chunk).replace(/\u001b\[[0-9;]*m/g, "").trim(); if (text) emit({ type: "output", text }); }; child.stdout.on("data", output); child.stderr.on("data", output); child.on("error", (error) => emit({ type: "error", message: error.message })); child.on("close", (code) => { this.authLoginProcess = null; emit({ type: "complete", code: code ?? 1 }); }); return { started: true }; });
    ipc.handle("auth:logout", async () => { await d.runtimeManager.ensure("codex"); const result = await d.runProcess(d.codexExecutable(), ["logout"], { timeoutMs: 20_000, env: d.codexEnvironment() }); if (result.code !== 0) throw new Error(result.stderr.trim() || "退出登录失败"); return { connected: false }; });
    ipc.handle("models:list", async (_event, value) => await this.models(parseInput(modelListSchema, value)));
    ipc.handle("agents:list", async () => ({ agents: await this.agents() }));
  }

  stop(): void { this.authLoginProcess?.kill("SIGTERM"); this.authLoginProcess = null; }

  private async agents(): Promise<Array<Record<string, unknown>>> {
    const d = this.deps; const statuses = Object.fromEntries((await d.runtimeManager.list()).map((status) => [status.agentId, status])); let claudeAuth: Record<string, unknown> = { connected: false };
    if (statuses["claude-code"].installed) try { const account = await d.claudeClient.accountInfo(process.cwd()); claudeAuth = { connected: Boolean(account), authMethod: account?.subscriptionType || account?.authMethod || "SDK", apiProvider: account?.apiProvider }; } catch {}
    return [{ id: "codex", name: "Codex", ...statuses.codex, bundled: false, managed: true, integrated: true, modes: [{ id: "default", label: "默认" }, { id: "plan", label: "计划" }] }, { id: "claude-code", name: "Claude Code", ...statuses["claude-code"], bundled: false, managed: true, auth: claudeAuth, integrated: true, modes: [{ id: "default", label: "默认" }, { id: "plan", label: "计划" }, { id: "accept-edits", label: "接受编辑" }, { id: "dont-ask", label: "不询问" }, { id: "auto", label: "自动批准" }, { id: "bypass-permissions", label: "绕过权限" }] }, { id: "pi", name: "Pi", ...statuses.pi, bundled: false, managed: true, integrated: true, modes: [{ id: "coding", label: "Coding tools" }] }];
  }

  private async models(input?: { agentId?: string; projectId?: string }): Promise<{ models: any[] }> {
    const d = this.deps; if (process.env.RUX_E2E === "1") return input?.agentId && input.agentId !== "codex" ? { models: [] } : { models: [{ id: "e2e-model", model: "e2e-model", displayName: "E2E Model", description: "Deterministic test model", hidden: false, isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "E2E" }] }] };
    const project = input?.projectId ? await d.resolveProject(input.projectId) : null; const cwd = project?.path ?? join(app.getPath("userData"), "standalone-workspace"); await mkdir(cwd, { recursive: true });
    if (input?.agentId === "claude-code") { await d.runtimeManager.ensure("claude-code"); const models = await d.claudeClient.listModels(cwd); return { models: models.map((model, index) => ({ id: `claude:${model.value}`, model: model.value, displayName: model.displayName, description: model.description, hidden: false, isDefault: index === 0 || model.value === "default", defaultReasoningEffort: "high", supportedReasoningEfforts: (model.supportedEffortLevels || ["low", "medium", "high"]).map((reasoningEffort) => ({ reasoningEffort, description: `${model.displayName} · ${reasoningEffort}` })), resolvedModel: model.resolvedModel })) }; }
    if (input?.agentId === "pi") { await d.runtimeManager.ensure("pi"); const runtime = await d.providerStore.materializePiRuntime(join(app.getPath("userData"), "agents", "pi")); if (!runtime) return { models: [] }; const models = await d.piClient.listModels(cwd, runtime); return { models: models.map((model, index) => ({ id: `pi:${model.provider}/${model.id}`, model: `${model.provider}/${model.id}`, displayName: model.name || model.id, description: `${model.provider} · ${model.contextWindow || "—"} tokens`, hidden: false, isDefault: index === 0, defaultReasoningEffort: model.reasoning ? "medium" : "none", supportedReasoningEfforts: (model.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"] : ["off"]).map((reasoningEffort) => ({ reasoningEffort, description: `${model.name || model.id} · ${reasoningEffort}` })) })) }; }
    return await d.loadCodexModels();
  }
}
