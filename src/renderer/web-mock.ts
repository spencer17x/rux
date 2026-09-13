import type { RuxApi } from "../electron/preload";

const thread = { id: "web-preview", title: "权限交互预览", agentId: "codex" as const, agentMode: "default" };
const projectThread = { id: "web-project-preview", title: "项目菜单预览", agentId: "codex" as const, agentMode: "default" };
const project = { id: "web-project", name: "rux-demo", path: "/Users/preview/rux-demo", threads: [projectThread] };
const previewGitState = { branch: "main", files: [{ path: "src/navigation/TopBar.tsx", status: "M", plus: 2, minus: 2, untracked: false, staged: false, unstaged: true }, { path: "src/renderer/types.ts", status: "M", plus: 1, minus: 1, untracked: false, staged: false, unstaged: true }, { path: "src/workspace/WorkspaceDock.tsx", status: "M", plus: 24, minus: 6, untracked: false, staged: false, unstaged: true }] };
let settings = { provider: "codex" as const, serviceName: "OpenAI Compatible", baseUrl: "https://api.openai.com/v1", hasApiKey: false, model: "gpt-5.6-sol", reasoning: "xhigh" as const, sandboxMode: "read-only" as "read-only" | "workspace-write" | "danger-full-access", uiFontSize: 14, allowConversationOverride: true, conversationSticky: false };
let storedMessages: Record<string, unknown[]> = {
  [projectThread.id]: Array.from({ length: 5 }, (_, index) => { const createdAt = new Date(Date.now() - (5 - index) * 180_000).toISOString(); const completedAt = new Date(new Date(createdAt).getTime() + (index + 1) * 8_000).toISOString(); const prompt = index === 4 ? "对话列的样式参考截图设计" : `第 ${index + 1} 轮：优化项目交互细节`; const reply = index === 4 ? "已补齐右侧工作区面板，并重新构建、启动本地应用。\n\n现在右侧和底部包含相同工具：\n\n- 环境\n- 审查\n- 终端\n- 浏览器\n- 文件\n- 侧边聊天\n\n两边共享当前工具、终端、文件、Git 和侧边聊天状态，但可以独立打开或关闭。" : `第 ${index + 1} 轮已经完成。\n\n这里展示用于视觉预览的说明内容，确保对话区域具有足够高度来验证 Sticky 的上一轮和下一轮切换。\n\n- 保持界面层级清楚\n- 保持控件状态明确\n- 保持滚动定位稳定`; return [{ id: `preview-user-${index}`, role: "user", text: prompt, createdAt, parts: [{ type: "text", text: prompt }] }, { id: `preview-assistant-${index}`, role: "assistant", status: "complete", createdAt, completedAt, parts: [{ type: "text", text: reply }] }]; }).flat(),
};
const noopOff = () => () => {};
const previewListeners = new Set<(event: any) => void>();
const previewRuns = new Map<string, number[]>();
const emitPreview = (event: any) => { for (const listener of previewListeners) listener(event); };
const previewImages = new Map<string, string>();
function storePreviewImage(name: string, dataUrl: string): string {
  const path = `/preview-attachments/${crypto.randomUUID()}/${name}`;
  previewImages.set(path, dataUrl);
  return path;
}
function choosePreviewFiles(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.oncancel = () => resolve([]);
    input.onchange = () => {
      Promise.all(Array.from(input.files || []).slice(0, 8).map(async (file) => {
        if (file.size > 10 * 1024 * 1024) throw new Error("单个预览附件不能超过 10 MB");
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("无法读取图片")); reader.readAsDataURL(file); });
        return storePreviewImage(file.name, dataUrl);
      })).then(resolve, reject);
    };
    input.click();
  });
}

export function installWebMock(): void {
  if (window.rux) return;
  if (typeof window.location !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "signature") {
    Object.assign(projectThread, { title: "优化对话界面" });
    Object.assign(project, { name: "rux", threads: [projectThread, { ...projectThread, id: "preview-history", title: "对话历史设计" }, { ...projectThread, id: "preview-models", title: "模型选择体验" }] });
    Object.assign(settings, { model: "gpt-6-astra", reasoning: "xhigh", conversationSticky: false });
    previewGitState.files = [];
    const firstStart = Date.now() - 180_000;
    const secondStart = Date.now() - 80_000;
    storedMessages = { [projectThread.id]: [
      { id: "signature-user-1", role: "user", text: "优化项目栏和常用组件。", parts: [{ type: "text", text: "优化项目栏和常用组件。" }], createdAt: new Date(firstStart).toISOString() },
      { id: "signature-assistant-1", role: "assistant", agentId: "codex", status: "complete", parts: [{ type: "text", text: "项目与会话的层级已整理，图标、按钮和菜单采用统一规范。\n\n左侧项目栏默认展开，文件明细按需查看。" }, { type: "tool-call", toolName: "fileChange", toolCallId: "signature-files", args: { changes: [{ path: "src/navigation/Sidebar.tsx" }, { path: "src/components/IconButton.tsx" }, { path: "src/workbench-theme.css" }] }, result: { status: "completed" } }], createdAt: new Date(firstStart).toISOString(), turnInfo: { agentId: "codex", model: "gpt-5.6-sol", reasoning: "high", elapsedMs: 18_400, usage: { inputTokens: 4980, outputTokens: 1340, totalTokens: 6320 } } },
      { id: "signature-user-2", role: "user", text: "每轮显示模型和实际消耗，但不要影响阅读。", parts: [{ type: "text", text: "每轮显示模型和实际消耗，但不要影响阅读。" }], createdAt: new Date(secondStart).toISOString() },
      { id: "signature-assistant-2", role: "assistant", agentId: "codex", status: "complete", parts: [{ type: "text", text: "已将运行信息压缩为一行，保留在每轮回复末尾。\n\n需要核对时可展开明细，其余时间保持简洁。" }], createdAt: new Date(secondStart).toISOString(), turnInfo: { agentId: "codex", model: "gpt-6-astra", reasoning: "xhigh", elapsedMs: 42_600, usage: { inputTokens: 9860, outputTokens: 2620, cachedInputTokens: 6144, reasoningOutputTokens: 1820, totalTokens: 12480 } } },
    ] };
  }
  window.rux = {
    voice: { status: async () => ({ available: false, message: "请在 Rux 桌面端使用系统语音" }) },
    settings: { get: async () => settings, save: async (input: any) => (settings = { ...settings, ...input }), test: async () => ({ ok: true, message: "预览连接正常" }) },
    providers: { list: async () => ({ activeProfileId: "", profiles: [] }), save: async (input: any) => input, remove: async () => ({ activeProfileId: "", profiles: [] }), setActive: async (id: string) => ({ activeProfileId: id }), test: async () => ({ ok: true, message: "预览连接正常" }) },
    auth: { status: async () => ({ connected: true, account: { email: "preview@rux.local", planType: "Local" } }), login: async () => ({ started: true }), logout: async () => ({ connected: false }), onLoginEvent: noopOff },
    models: { list: async () => ({ models: ["gpt-5.6-sol", "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"].map((model, index) => ({ id: model, model, displayName: model.replace(/^gpt-/i, "GPT-").replace(/-(astra|sol|terra|luna|mini|codex-spark)$/i, (_, name: string) => ` ${name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")}`), description: "本地视觉预览模型", inputModalities: ["text", "image"], isDefault: index === 0, defaultReasoningEffort: "xhigh", supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort === "ultra" ? "更快消耗使用额度" : "" })), serviceTiers: index < 4 ? [{ id: "priority", name: "Fast", description: model === "gpt-6-astra" ? "2x speed, increased usage" : "1.5x speed, increased usage" }] : [], defaultServiceTier: null })) }) },
    agents: { list: async () => ({ agents: [{ id: "codex", name: "Codex", installed: true, managed: true, integrated: true, version: "preview", modes: [{ id: "default", label: "默认" }, { id: "plan", label: "计划" }] }] }) },
    runtimes: { list: async () => ({ runtimes: [] }), ensure: async () => ({ installed: true }), onProgress: noopOff },
    projects: { list: async () => ({ projects: [project], standaloneThreads: [thread] }), defaultParent: async () => "/tmp", chooseDirectory: async () => null, import: async () => project, clone: async () => project, create: async () => project, remove: async () => ({ project, workspace: { projects: [], standaloneThreads: [thread] } }), addThread: async () => projectThread, addStandalone: async () => thread, updateThread: async (input: any) => ({ ...projectThread, ...input }) },
    threads: { update: async (input: any) => ({ ...thread, ...input }), remove: async () => ({ thread, workspace: { projects: [], standaloneThreads: [] } }) },
    messages: { list: async () => storedMessages, save: async (input: any) => { storedMessages = input; return { saved: true }; } },
    agent: {
      send: async () => ({ text: "预览回复" }),
      start: async (input: any) => {
        const timers = [window.setTimeout(() => emitPreview({ runId: input.runId, type: "text-delta", itemId: `preview-${input.runId}`, delta: "这轮已收到你的调整要求，可以继续补充具体细节。" }), 120), window.setTimeout(() => {
          emitPreview({ runId: input.runId, type: "turn-completed", status: "completed", turnInfo: { model: input.model, reasoning: input.reasoning, elapsedMs: 720, usage: { inputTokens: 640, outputTokens: 160, totalTokens: 800 } } });
          previewRuns.delete(input.runId);
        }, 720)];
        previewRuns.set(input.runId, timers);
        return { runId: input.runId, threadId: "preview", turnId: input.runId };
      },
      interrupt: async (input: any) => { for (const timer of previewRuns.get(input.runId) || []) window.clearTimeout(timer); previewRuns.delete(input.runId); emitPreview({ runId: input.runId, type: "turn-completed", status: "interrupted" }); return { interrupted: true }; },
      respondToApproval: async () => ({ responded: true }),
      onEvent: (listener: (event: any) => void) => { previewListeners.add(listener); return () => previewListeners.delete(listener); },
    },
    git: { status: async () => previewGitState, diff: async () => "", branches: async () => ["main"], switchBranch: async () => previewGitState, compare: async () => previewGitState, compareDiff: async () => "", remote: async () => "", instructions: async () => ({ files: [], stagedPaths: [] }), commitPush: async () => previewGitState, stage: async () => previewGitState, discard: async () => previewGitState },
    files: { list: async () => [], open: async () => ({ opened: true }) },
    terminal: { start: async () => ({ started: true }), write: async () => ({ written: true }), resize: async () => ({ resized: true }), stop: async () => ({ stopped: true }), onData: noopOff },
    system: { openPath: async () => ({ opened: true }), chooseFiles: choosePreviewFiles, importImage: async (input: { name: string; mimeType: string; base64: string }) => storePreviewImage(input.name, `data:${input.mimeType};base64,${input.base64}`), previewImage: async ({ path }: { path: string }) => { const image = previewImages.get(path); if (!image) throw new Error("预览图片已失效，请重新添加"); return image; }, copy: async () => ({ copied: true }), openExternal: async () => ({ opened: true }), openMessageTarget: async () => ({ opened: true }), showMessageContextMenu: async () => ({ shown: true }), info: async () => ({ appVersion: "preview", electronVersion: "preview", chromeVersion: "preview", platform: "darwin", arch: "arm64", codexVersion: "preview" }) },
  } as unknown as RuxApi;
}
