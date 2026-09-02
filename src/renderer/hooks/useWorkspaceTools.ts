import { useCallback, useEffect, useRef, useState } from "react";
import type { RuxApi } from "../../electron/preload";
import type { AppSettings } from "./useAppBootstrap";
import type { AgentId, WorkspaceToolId } from "../types";
import { userFacingError } from "../errors";
import { useTerminalController } from "./useTerminalController";

type SideMessage = { id: string; role: "user" | "assistant"; text: string };
type SideApproval = { id: string; label: string };
type SideRun = { runId: string; assistantId: string; agentId: AgentId; threadId: string; turnId: string; deltaItems: Set<string> };
type WorkspacePanelPlacement = "bottom" | "right";
const projectOnlyTools = new Set<WorkspaceToolId>(["review", "terminal", "browser", "files"]);

export function useWorkspaceTools(api: RuxApi, projectId: string | undefined, selectedAgent: AgentId, agentMode: string, preference: { model: string; reasoning: AppSettings["reasoning"]; serviceTier: string | null }, settings: AppSettings, refreshGit: (projectId?: string) => Promise<void>, notify: (message: string) => void) {
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false); const [rightPanelOpen, setRightPanelOpen] = useState(false); const [activeTool, setActiveTool] = useState<WorkspaceToolId>("terminal");
  const [projectFiles, setProjectFiles] = useState<string[]>([]); const [remoteUrl, setRemoteUrl] = useState(""); const [sideMessages, setSideMessages] = useState<SideMessage[]>([]); const [sideValue, setSideValue] = useState(""); const [sideSending, setSideSending] = useState(false); const [sideThreadId, setSideThreadId] = useState(""); const [sideApproval, setSideApproval] = useState<SideApproval | null>(null);
  const sideRun = useRef<SideRun | null>(null);
  const terminal = useTerminalController(api, projectId, () => { void refreshGit(); }, notify);
  useEffect(() => { const active = sideRun.current; if (active) void api.agent.interrupt({ agentId: active.agentId, runId: active.runId, threadId: active.threadId || active.runId, turnId: active.turnId || active.runId }).catch(() => {}); if (projectId) { api.files.list(projectId).then((files) => setProjectFiles(files as string[])).catch(() => setProjectFiles([])); api.git.remote(projectId).then((url) => setRemoteUrl(String(url))).catch(() => setRemoteUrl("")); } else { setProjectFiles([]); setRemoteUrl(""); } setSideMessages([]); setSideThreadId(""); setSideValue(""); setSideApproval(null); setSideSending(false); sideRun.current = null; }, [api, projectId, selectedAgent]);
  useEffect(() => api.agent.onEvent((raw) => {
    const event = raw as Record<string, any>; const run = sideRun.current; if (!run || event.runId !== run.runId) return;
    const updateAssistant = (update: (text: string) => string) => setSideMessages((current) => current.map((message) => message.id === run.assistantId ? { ...message, text: update(message.text) } : message));
    if (event.type === "thread-started" && event.threadId) { run.threadId = String(event.threadId); setSideThreadId(run.threadId); }
    if (event.turnId) run.turnId = String(event.turnId);
    if (event.type === "text-delta") { run.deltaItems.add(String(event.itemId || "text")); updateAssistant((text) => `${text}${String(event.delta || "")}`); return; }
    if (event.type === "item-completed" && event.item?.type === "agentMessage" && !run.deltaItems.has(String(event.itemId || event.item.id || ""))) { const text = String(event.item.text || ""); if (text) updateAssistant((current) => `${current}${current ? "\n" : ""}${text}`); return; }
    if (event.type === "approval-request" && event.approval?.id) { setSideApproval({ id: String(event.approval.id), label: String(event.approval.title || event.approval.displayName || event.approval.toolName || "此操作") }); return; }
    if (event.type === "error") { const error = userFacingError(event.error || "Agent 执行失败"); updateAssistant((text) => text ? `${text}\n${error}` : error); setSideSending(false); setSideApproval(null); sideRun.current = null; return; }
    if (event.type === "turn-completed") { if (event.status !== "completed" && event.error) updateAssistant((text) => text ? `${text}\n${userFacingError(event.error)}` : userFacingError(event.error)); setSideSending(false); setSideApproval(null); sideRun.current = null; }
  }), [api]);
  const closeBottomPanel = useCallback(async () => { setBottomPanelOpen(false); if (!rightPanelOpen) await terminal.closeTerminal(); }, [rightPanelOpen, terminal.closeTerminal]);
  const closeRightPanel = useCallback(async () => { setRightPanelOpen(false); if (!bottomPanelOpen) await terminal.closeTerminal(); }, [bottomPanelOpen, terminal.closeTerminal]);
  const toggleBottomPanel = useCallback(async () => { if (bottomPanelOpen) { await closeBottomPanel(); return; } setBottomPanelOpen(true); if (activeTool === "terminal") await terminal.startTerminal(); }, [activeTool, bottomPanelOpen, closeBottomPanel, terminal.startTerminal]);
  const toggleRightPanel = useCallback(async () => { if (rightPanelOpen) { await closeRightPanel(); return; } setRightPanelOpen(true); if (activeTool === "terminal") await terminal.startTerminal(); }, [activeTool, closeRightPanel, rightPanelOpen, terminal.startTerminal]);
  const selectWorkspaceTool = useCallback(async (tool: WorkspaceToolId, placement: WorkspacePanelPlacement = "bottom") => { if (projectOnlyTools.has(tool) && !projectId) { notify("请先选择一个项目会话"); return; } setActiveTool(tool); placement === "right" ? setRightPanelOpen(true) : setBottomPanelOpen(true); if (tool === "terminal") await terminal.startTerminal(); if (tool === "review") await refreshGit(projectId); if (tool === "files" && projectId) api.files.list(projectId).then((files) => setProjectFiles(files as string[])).catch((error) => notify(error instanceof Error ? error.message : String(error))); if (tool === "browser" && projectId) api.git.remote(projectId).then((url) => setRemoteUrl(String(url))).catch(() => setRemoteUrl("")); }, [api, notify, projectId, refreshGit, terminal.startTerminal]);
  const openRemote = useCallback(async () => { if (!projectId) return; try { const remote = String(await api.git.remote(projectId)); if (!remote) { notify("当前项目没有 origin 远程地址"); return; } const url = remote.startsWith("git@") ? `https://${remote.slice(4).replace(":", "/").replace(/\.git$/, "")}` : remote.replace(/\.git$/, ""); await api.system.openExternal(url); } catch (error) { notify(error instanceof Error ? error.message : String(error)); } }, [api, notify, projectId]);
  const sendSideChat = useCallback(async () => {
    const prompt = sideValue.trim(); if (!prompt || sideSending) return;
    const runId = crypto.randomUUID(); const assistantId = crypto.randomUUID(); const user: SideMessage = { id: crypto.randomUUID(), role: "user", text: prompt };
    sideRun.current = { runId, assistantId, agentId: selectedAgent, threadId: sideThreadId, turnId: "", deltaItems: new Set() };
    setSideMessages((current) => [...current, user, { id: assistantId, role: "assistant", text: "" }]); setSideValue(""); setSideSending(true); setSideApproval(null);
    try {
      const result = await api.agent.start({ runId, agentId: selectedAgent, projectId, prompt, model: preference.model, reasoning: preference.reasoning, serviceTier: preference.serviceTier, sandboxMode: settings.sandboxMode, ...(sideThreadId ? { threadId: sideThreadId, nativeSessionId: sideThreadId } : {}), mode: agentMode }) as Record<string, string>;
      if (sideRun.current?.runId === runId) { sideRun.current.threadId = result.threadId || result.sessionId || sideRun.current.threadId; sideRun.current.turnId = result.turnId || sideRun.current.turnId; if (sideRun.current.threadId) setSideThreadId(sideRun.current.threadId); }
    } catch (error) {
      const message = userFacingError(error); setSideMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: message } : item)); setSideSending(false); sideRun.current = null;
    }
  }, [agentMode, api, preference.model, preference.reasoning, preference.serviceTier, projectId, selectedAgent, settings.sandboxMode, sideSending, sideThreadId, sideValue]);
  const respondToSideApproval = useCallback(async (decision: "accept" | "acceptForSession" | "decline") => { if (!sideApproval) return; try { await api.agent.respondToApproval({ approvalId: sideApproval.id, decision }); setSideApproval(null); } catch (error) { notify(userFacingError(error)); } }, [api, notify, sideApproval]);
  const cancelSideChat = useCallback(async () => { const run = sideRun.current; if (!run) return; try { await api.agent.interrupt({ agentId: run.agentId, runId: run.runId, threadId: run.threadId || run.runId, turnId: run.turnId || run.runId }); } catch (error) { notify(userFacingError(error)); } }, [api, notify]);
  return { bottomPanelOpen, setBottomPanelOpen, rightPanelOpen, setRightPanelOpen, activeTool, projectFiles, remoteUrl, sideMessages, sideValue, setSideValue, sideSending, sideApproval, sideAgentLabel: selectedAgent === "claude-code" ? "Claude Code" : selectedAgent === "pi" ? "Pi" : settings.provider === "custom" ? settings.serviceName : "Codex", closeBottomPanel, closeRightPanel, toggleBottomPanel, toggleRightPanel, selectWorkspaceTool, openRemote, sendSideChat, respondToSideApproval, cancelSideChat, ...terminal };
}
