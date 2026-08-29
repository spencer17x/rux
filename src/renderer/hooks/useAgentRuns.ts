import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { RuxApi } from "../../electron/preload";
import type { ComposerSettings, Reasoning } from "../../composer/ComposerControls";
import { reduceStreamEvent, type AgentEvent, type MessageStore, type RuxMessage } from "../messages";
import type { ActiveThread, AgentId, ThreadRecord, WorkspaceState } from "../types";
import { userFacingError } from "../errors";

type AgentDefinition = { id: AgentId; name: string; integrated: boolean };
type RunContext = { runId: string; localThreadId: string; assistantMessageId: string; type: "project" | "standalone"; projectId?: string; prompt: string; shouldRename: boolean; agentId: AgentId; agentMode: string; threadId: string; turnId: string };

type Input = {
  api: RuxApi; activeThread: ActiveThread | null; activeProjectId?: string; selectedAgent: AgentId; agentMode: string;
  preference: { model: string; reasoning: Reasoning }; settings: ComposerSettings; attachments: string[]; webSearch: boolean; agents: AgentDefinition[];
  setMessages: Dispatch<SetStateAction<MessageStore>>; setAttachments: Dispatch<SetStateAction<string[]>>; setComposerValue: Dispatch<SetStateAction<string>>;
  setActiveThread: Dispatch<SetStateAction<ActiveThread | null>>; reloadWorkspace: () => Promise<WorkspaceState>; refreshGit: (projectId?: string) => Promise<void>; notify: (message: string) => void;
};

export function useAgentRuns(input: Input) {
  const [runningThreadIds, setRunningThreadIds] = useState<Set<string>>(() => new Set());
  const contexts = useRef<Map<string, RunContext>>(new Map());
  const activeThreadRef = useRef(input.activeThread);
  useEffect(() => { activeThreadRef.current = input.activeThread; }, [input.activeThread]);
  useEffect(() => input.api.agent.onEvent((rawEvent) => {
    const event = rawEvent as AgentEvent; const context = contexts.current.get(event.runId); if (!context) return;
    if (event.type === "thread-started" && event.threadId) {
      context.threadId = event.threadId;
      input.api.threads.update({ type: context.type, projectId: context.projectId, threadId: context.localThreadId, agentId: context.agentId, nativeSessionId: event.threadId, agentMode: context.agentMode, codexThreadId: context.agentId === "codex" ? event.threadId : undefined, title: context.shouldRename ? context.prompt.slice(0, 28) : undefined }).then((updated) => {
        if (activeThreadRef.current?.id === context.localThreadId) input.setActiveThread((current) => current ? { ...current, ...(updated as Partial<ThreadRecord>) } : current);
        void input.reloadWorkspace();
      }).catch((error) => input.notify(error instanceof Error ? error.message : String(error)));
    }
    if (event.turnId) context.turnId = event.turnId;
    input.setMessages((current) => ({ ...current, [context.localThreadId]: (current[context.localThreadId] || []).map((message) => message.id === context.assistantMessageId ? reduceStreamEvent(message, event) : message) }));
    if (event.type === "turn-completed" || event.type === "error") {
      contexts.current.delete(event.runId); setRunningThreadIds((current) => { const next = new Set(current); next.delete(context.localThreadId); return next; }); if (context.projectId) void input.refreshGit(context.projectId);
    }
  }), [input.api, input.notify, input.refreshGit, input.reloadWorkspace, input.setActiveThread, input.setMessages]);
  const sending = input.activeThread ? runningThreadIds.has(input.activeThread.id) : false;
  const sendMessage = useCallback(async (nextPrompt = "") => {
    const prompt = nextPrompt.trim(); if (!prompt || !input.activeThread || sending) return;
    const agent = input.agents.find((item) => item.id === input.selectedAgent); if (!agent?.integrated) { input.notify(`${agent?.name || input.selectedAgent} 适配器尚未启用`); return; }
    let targetThread = input.activeThread;
    if (targetThread.draft) {
      try {
        const persisted = targetThread.type === "project"
          ? targetThread.projectId ? await input.api.projects.addThread({ projectId: targetThread.projectId, title: targetThread.title }) as ThreadRecord : null
          : await input.api.projects.addStandalone({ title: targetThread.title }) as ThreadRecord;
        if (!persisted) return;
        targetThread = { ...targetThread, ...persisted, draft: false };
        await input.reloadWorkspace();
        input.setActiveThread(targetThread);
      } catch (error) {
        input.notify(userFacingError(error));
        return;
      }
    }
    const runId = crypto.randomUUID();
    const userMessage: RuxMessage = { id: crypto.randomUUID(), role: "user", text: prompt, parts: [{ type: "text", text: prompt }], createdAt: new Date().toISOString(), agentId: input.selectedAgent };
    const assistantMessage: RuxMessage = { id: crypto.randomUUID(), role: "assistant", text: "", parts: [], status: "running", createdAt: new Date().toISOString(), agentId: input.selectedAgent };
    const nativeSessionId = targetThread.nativeSessionId || (input.selectedAgent === "codex" ? targetThread.codexThreadId : "") || "";
    const context: RunContext = { runId, localThreadId: targetThread.id, assistantMessageId: assistantMessage.id, type: targetThread.type, projectId: targetThread.projectId, prompt, shouldRename: targetThread.title.startsWith("未命名") || targetThread.title === "项目会话", agentId: input.selectedAgent, agentMode: input.agentMode, threadId: nativeSessionId, turnId: "" };
    contexts.current.set(runId, context); input.setMessages((current) => ({ ...current, [targetThread.id]: [...(current[targetThread.id] || []), userMessage, assistantMessage] })); input.setComposerValue(""); setRunningThreadIds((current) => new Set(current).add(targetThread.id));
    try { const result = await input.api.agent.start({ runId, agentId: input.selectedAgent, projectId: targetThread.projectId, prompt, model: input.preference.model, reasoning: input.preference.reasoning, sandboxMode: input.settings.sandboxMode, images: input.attachments, webSearch: input.webSearch, ...(nativeSessionId ? { threadId: nativeSessionId, nativeSessionId } : {}), mode: input.agentMode }) as Record<string, string>; context.threadId = result.threadId || result.sessionId || context.threadId; context.turnId = result.turnId || context.turnId; input.setAttachments([]); }
    catch (error) { contexts.current.delete(runId); input.setMessages((current) => ({ ...current, [targetThread.id]: (current[targetThread.id] || []).map((message) => message.id === assistantMessage.id ? reduceStreamEvent(message, { type: "error", error: userFacingError(error) }) : message) })); setRunningThreadIds((current) => { const next = new Set(current); next.delete(targetThread.id); return next; }); }
  }, [input, sending]);
  const cancelCurrentRun = useCallback(async () => { const context = [...contexts.current.values()].find((item) => item.localThreadId === input.activeThread?.id); if (!context) return; if (!context.threadId || !context.turnId) { input.notify("Agent 正在初始化，请稍后再停止"); return; } try { await input.api.agent.interrupt({ agentId: context.agentId, runId: context.runId, threadId: context.threadId, turnId: context.turnId }); } catch (error) { input.notify(error instanceof Error ? error.message : String(error)); } }, [input]);
  const respondToApproval = useCallback(async ({ approvalId, approved, optionId }: { approvalId: string; approved: boolean; optionId?: string }) => { const decision = approved ? optionId === "allow-session" ? "acceptForSession" : "accept" : "decline"; await input.api.agent.respondToApproval({ approvalId, decision }); input.setMessages((current) => Object.fromEntries(Object.entries(current).map(([threadId, messages]) => [threadId, messages.map((message) => ({ ...message, parts: message.parts?.map((part) => part.approval?.id === approvalId ? { ...part, approval: { ...part.approval, approved, optionId } } : part) }))]))); }, [input]);
  return { sending, sendMessage, cancelCurrentRun, respondToApproval, isThreadRunning: (threadId: string) => [...contexts.current.values()].some((context) => context.localThreadId === threadId), isProjectRunning: (projectId: string) => [...contexts.current.values()].some((context) => context.projectId === projectId) };
}
