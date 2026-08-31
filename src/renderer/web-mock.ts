import type { RuxApi } from "../electron/preload";

const thread = { id: "web-preview", title: "权限交互预览", agentId: "codex" as const, agentMode: "default" };
let settings = { provider: "codex" as const, serviceName: "OpenAI Compatible", baseUrl: "https://api.openai.com/v1", hasApiKey: false, model: "gpt-5.6-sol", reasoning: "medium" as const, sandboxMode: "read-only" as "read-only" | "workspace-write" | "danger-full-access", uiFontSize: 14, allowConversationOverride: true, conversationSticky: true };
let storedMessages: Record<string, unknown[]> = {};
const noopOff = () => () => {};

export function installWebMock(): void {
  if (window.rux) return;
  window.rux = {
    settings: { get: async () => settings, save: async (input: any) => (settings = { ...settings, ...input }), test: async () => ({ ok: true, message: "预览连接正常" }) },
    providers: { list: async () => ({ activeProfileId: "", profiles: [] }), save: async (input: any) => input, remove: async () => ({ activeProfileId: "", profiles: [] }), setActive: async (id: string) => ({ activeProfileId: id }), test: async () => ({ ok: true, message: "预览连接正常" }) },
    auth: { status: async () => ({ connected: true, account: { email: "preview@rux.local", planType: "Local" } }), login: async () => ({ started: true }), logout: async () => ({ connected: false }), onLoginEvent: noopOff },
    models: { list: async () => ({ models: [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "本地视觉预览模型", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "中" }] }] }) },
    agents: { list: async () => ({ agents: [{ id: "codex", name: "Codex", installed: true, managed: true, integrated: true, version: "preview", modes: [{ id: "default", label: "默认" }, { id: "plan", label: "计划" }] }] }) },
    runtimes: { list: async () => ({ runtimes: [] }), ensure: async () => ({ installed: true }), onProgress: noopOff },
    projects: { list: async () => ({ projects: [], standaloneThreads: [thread] }), defaultParent: async () => "/tmp", chooseDirectory: async () => null, import: async () => ({}), clone: async () => ({}), create: async () => ({}), remove: async () => ({}), addThread: async () => thread, addStandalone: async () => thread, updateThread: async (input: any) => ({ ...thread, ...input }) },
    threads: { update: async (input: any) => ({ ...thread, ...input }), remove: async () => ({ thread, workspace: { projects: [], standaloneThreads: [] } }) },
    messages: { list: async () => storedMessages, save: async (input: any) => { storedMessages = input; return { saved: true }; } },
    agent: { send: async () => ({ text: "预览回复" }), start: async () => ({ runId: "preview", threadId: "preview", turnId: "preview" }), interrupt: async () => ({ interrupted: true }), respondToApproval: async () => ({ responded: true }), onEvent: noopOff },
    git: { status: async () => ({ branch: "—", files: [] }), diff: async () => "", branches: async () => [], switchBranch: async () => ({ branch: "—", files: [] }), compare: async () => ({ branch: "—", files: [] }), compareDiff: async () => "", remote: async () => "", instructions: async () => ({ files: [], stagedPaths: [] }), commitPush: async () => ({ branch: "—", files: [] }), stage: async () => ({ branch: "—", files: [] }), discard: async () => ({ branch: "—", files: [] }) },
    files: { list: async () => [], open: async () => ({ opened: true }) },
    terminal: { start: async () => ({ started: true }), write: async () => ({ written: true }), resize: async () => ({ resized: true }), stop: async () => ({ stopped: true }), onData: noopOff },
    system: { openPath: async () => ({ opened: true }), chooseFiles: async () => [], copy: async () => ({ copied: true }), openExternal: async () => ({ opened: true }), openMessageTarget: async () => ({ opened: true }), showMessageContextMenu: async () => ({ shown: true }), info: async () => ({ appVersion: "preview", electronVersion: "preview", chromeVersion: "preview", platform: "darwin", arch: "arm64", codexVersion: "preview" }) },
  } as unknown as RuxApi;
}
