import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { RuxApi } from "../../electron/preload";
import type { ComposerSettings, ModelInfo, Reasoning } from "../../composer/ComposerControls";
import { normalizedMessages, type MessageStore } from "../messages";
import type { AgentId, AuthState, WorkspaceState } from "../types";

export type AppSettings = ComposerSettings & { baseUrl: string; hasApiKey: boolean; uiFontSize: number; allowConversationOverride: boolean; conversationSticky: boolean };
export type AgentDefinition = { id: AgentId; name: string; installed: boolean; managed: boolean; integrated: boolean; version: string; path?: string; auth?: Record<string, any>; modes?: Array<{ id: string; label: string }> };
export type AgentPreferences = Record<AgentId, { model: string; reasoning: Reasoning }>;
export type ProviderStore = { activeProfileId: string; profiles: Array<{ id: string; name: string; protocol: "openai-responses" | "openai-chat" | "anthropic-messages" | "ollama"; baseUrl: string; hasApiKey: boolean; headers: Record<string, string>; compatibleAgents: "pi"[]; models: Array<{ id: string; name: string; reasoningLevels: string[] }> }> };
export type RuntimeProgress = Record<string, { agentId: string; state: string; percent?: number; message?: string }>;

const fallbackSettings: AppSettings = { provider: "codex", serviceName: "OpenAI Compatible", baseUrl: "https://api.openai.com/v1", hasApiKey: false, model: "", reasoning: "high", sandboxMode: "workspace-write", uiFontSize: 14, allowConversationOverride: true, conversationSticky: true };
const fallbackAgents: AgentDefinition[] = [{ id: "codex", name: "Codex", installed: false, managed: true, integrated: true, version: "0.149.1", modes: [{ id: "default", label: "默认" }, { id: "plan", label: "计划" }] }];
function loadPreferences(): AgentPreferences { const fallback: AgentPreferences = { codex: { model: "", reasoning: "high" }, "claude-code": { model: "default", reasoning: "high" }, pi: { model: "", reasoning: "medium" } }; try { return { ...fallback, ...JSON.parse(localStorage.getItem("rux.agent-preferences.v1") || "{}") } as AgentPreferences; } catch { return fallback; } }

export function useAppBootstrap(api: RuxApi, selectedAgent: AgentId, activeProjectId: string | undefined, workspaceReady: boolean, setWorkspaceReady: Dispatch<SetStateAction<boolean>>, initializeWorkspace: (workspace: WorkspaceState, parent: string) => Promise<void>, setMessages: Dispatch<SetStateAction<MessageStore>>) {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings); const [auth, setAuth] = useState<AuthState>({ connected: false, message: "", account: null });
  const [models, setModels] = useState<ModelInfo[]>([]); const [modelsByAgent, setModelsByAgent] = useState<Partial<Record<AgentId, ModelInfo[]>>>({}); const [agents, setAgents] = useState<AgentDefinition[]>(fallbackAgents);
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>(loadPreferences); const [providerStore, setProviderStore] = useState<ProviderStore>({ activeProfileId: "", profiles: [] }); const [runtimeProgress, setRuntimeProgress] = useState<RuntimeProgress>({});
  const [systemInfo, setSystemInfo] = useState<Record<string, string>>({}); const [modelsLoading, setModelsLoading] = useState(true); const [modelsError, setModelsError] = useState(""); const [codexModelsLoading, setCodexModelsLoading] = useState(true); const [codexModelsError, setCodexModelsError] = useState(""); const [fatalError, setFatalError] = useState("");
  useEffect(() => { localStorage.setItem("rux.agent-preferences.v1", JSON.stringify(agentPreferences)); }, [agentPreferences]);
  useEffect(() => { document.documentElement.style.setProperty("--ui-font-size", `${settings.uiFontSize || 14}px`); }, [settings.uiFontSize]);
  useEffect(() => {
    let cancelled = false;
    const offRuntime = api.runtimes.onProgress((raw) => { const progress = raw as RuntimeProgress[string]; if (cancelled) return; setRuntimeProgress((current) => ({ ...current, [progress.agentId]: progress })); if (progress.state === "ready") api.agents.list().then(({ agents: next }) => { if (!cancelled) setAgents(next as AgentDefinition[]); }).catch(() => {}); });
    const offLogin = api.auth.onLoginEvent((raw) => { const event = raw as { type: string; text?: string; message?: string }; if (cancelled) return; if (event.type === "output") setAuth((current) => ({ ...current, message: event.text })); if (event.type === "error") setAuth((current) => ({ ...current, message: event.message })); if (event.type === "complete") api.auth.status().then((next) => { if (!cancelled) setAuth(next as AuthState); }).catch(() => {}); });
    Promise.all([api.projects.list(), api.settings.get(), api.auth.status(), api.projects.defaultParent(), api.messages.list()]).then(async ([workspace, nextSettings, nextAuth, parent, storedMessages]) => {
      if (cancelled) return; const typedSettings = nextSettings as AppSettings; setSettings(typedSettings); setAuth(nextAuth as AuthState); if (storedMessages && Object.keys(storedMessages).length) setMessages(normalizedMessages(storedMessages as MessageStore)); setAgentPreferences((current) => ({ ...current, codex: { model: typedSettings.model, reasoning: typedSettings.reasoning } })); await initializeWorkspace(workspace as WorkspaceState, String(parent)); if (!cancelled) setWorkspaceReady(true);
    }).catch((error) => setFatalError(error instanceof Error ? error.message : String(error)));
    api.agents.list().then(({ agents: detected }) => { if (!cancelled && detected?.length) setAgents(detected as AgentDefinition[]); }).catch(() => {});
    api.system.info().then((info) => { if (!cancelled) setSystemInfo(info as Record<string, string>); }).catch(() => {});
    api.providers.list().then((store) => { if (!cancelled) setProviderStore(store as ProviderStore); }).catch(() => {});
    return () => { cancelled = true; offRuntime(); offLogin(); };
  }, []);
  useEffect(() => {
    if (!workspaceReady) return; let cancelled = false; setCodexModelsLoading(true); if (selectedAgent === "codex") { setModelsLoading(true); setModelsError(""); }
    api.models.list({ agentId: "codex", projectId: activeProjectId }).then(({ models: raw }) => { if (cancelled) return; const next = raw as ModelInfo[]; setModels(next); setCodexModelsError(""); if (selectedAgent === "codex") setModelsError(""); setAgentPreferences((current) => { const existing = current.codex; const selected = next.find((model) => model.model === existing.model) || next.find((model) => model.isDefault) || next[0]; return selected ? { ...current, codex: { model: selected.model, reasoning: selected.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === existing.reasoning) ? existing.reasoning : selected.defaultReasoningEffort } } : current; }); api.auth.status().then((nextAuth) => { if (!cancelled) setAuth(nextAuth as AuthState); }).catch(() => {}); }).catch((error) => { if (cancelled) return; const message = error instanceof Error ? error.message : String(error); setCodexModelsError(message); if (selectedAgent === "codex") setModelsError(message); }).finally(() => { if (!cancelled) { setCodexModelsLoading(false); if (selectedAgent === "codex") setModelsLoading(false); } });
    return () => { cancelled = true; };
  }, [activeProjectId, api, providerStore.activeProfileId, providerStore.profiles, selectedAgent, workspaceReady]);
  useEffect(() => {
    if (!workspaceReady || selectedAgent === "codex") return; let cancelled = false; setModelsLoading(true); setModelsError("");
    api.models.list({ agentId: selectedAgent, projectId: activeProjectId }).then(({ models: raw }) => { if (cancelled) return; const next = raw as ModelInfo[]; setModelsByAgent((current) => ({ ...current, [selectedAgent]: next })); setAgentPreferences((current) => { const existing = current[selectedAgent]; const selected = next.find((model) => model.model === existing.model) || next.find((model) => model.isDefault) || next[0]; return selected ? { ...current, [selectedAgent]: { model: selected.model, reasoning: selected.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === existing.reasoning) ? existing.reasoning : selected.defaultReasoningEffort } } : current; }); }).catch((error) => { if (!cancelled) setModelsError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [activeProjectId, api, providerStore.activeProfileId, providerStore.profiles, selectedAgent, workspaceReady]);
  const saveSettings = async (input: Partial<AppSettings> & { apiKey?: string }) => { const saved = await api.settings.save(input) as AppSettings; setSettings(saved); return saved; };
  const testSettings = async (input: Partial<AppSettings> & { apiKey?: string }) => await api.settings.test(input);
  const saveProvider = async (input: unknown) => { const saved = await api.providers.save(input); setProviderStore(await api.providers.list() as ProviderStore); return saved; };
  const removeProvider = async (id: string) => { const store = await api.providers.remove(id) as ProviderStore; setProviderStore(store); return store; };
  const setActiveProvider = async (id: string) => { await api.providers.setActive(id); const store = await api.providers.list() as ProviderStore; setProviderStore(store); return store; };
  return { settings, setSettings, auth, setAuth, models, modelsByAgent, agents, agentPreferences, setAgentPreferences, providerStore, runtimeProgress, systemInfo, modelsLoading, modelsError, codexModelsLoading, codexModelsError, fatalError, saveSettings, testSettings, saveProvider, removeProvider, setActiveProvider };
}
