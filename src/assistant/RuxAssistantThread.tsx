import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode, type RefObject } from "react";
import {
  AuiIf,
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  useMessageTiming,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  Check,
  CircleNotch,
  Code,
  Copy,
  FileText,
  Globe,
  MagnifyingGlass,
  Microphone,
  Paperclip,
  PencilSimple,
  Plus,
  Robot,
  Stop,
  TerminalWindow,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { RuxMessage } from "../renderer/messages";
import { adjacentStickyTurn, completedStickyTurns } from "../renderer/messages";
import { messageTargetFromHref } from "../renderer/message-targets";
import type { AgentId } from "../renderer/types";
import PermissionModeIcon from "../components/PermissionModeIcon";
import { compactModelName } from "../composer/ComposerControls";

type AgentDefinition = { id: AgentId; name: string; installed: boolean; integrated: boolean; version: string; modes?: Array<{ id: string; label: string }> };
type RuntimeProgress = Record<string, { state: string; percent?: number; message?: string }>;
type ApprovalResponse = { approvalId: string; approved: boolean; optionId?: string };
type OverlayId = "agents" | "agent-mode" | "run-settings" | "sandbox";
type Props = {
  messages: RuxMessage[]; running: boolean; emptyTitle: string; projectId?: string; onNewMessage: (text: string) => Promise<unknown>; onCancel: () => Promise<unknown>; onApproval: (response: ApprovalResponse) => Promise<unknown>;
  conversationSticky: boolean;
  agents: AgentDefinition[]; runtimeProgress: RuntimeProgress; selectedAgent: AgentId; onSelectAgent: (agentId: AgentId) => void; agentMode: string; onAgentMode: (mode: string) => void;
  modelLabel: string; reasoningLabel: string; permissionLabel: string; permissionMode: "read-only" | "workspace-write" | "danger-full-access"; showPermission?: boolean; modelOpen: boolean; sandboxOpen: boolean;
  permissionDanger?: boolean;
  modelPopover: ReactNode; permissionPopover: ReactNode; onToggleModel: () => void; onToggleSandbox: () => void;
  activeOverlay: OverlayId | null; onOverlayChange: (overlay: OverlayId | null) => void;
  attachments: string[]; showAttachments?: boolean; webSearch?: boolean; showWebSearch?: boolean; onToggleWebSearch: () => void;
  draftKey: string; draftText: string; onDraftTextChange: (text: string) => void;
  onAddFiles: () => void; onRemoveAttachment: (path: string) => void; listening: boolean; onVoice: () => void;
  workspaceSummary?: ReactNode;
};

const toolPresentation = {
  shell: { label: "执行命令", Icon: TerminalWindow },
  commandExecution: { label: "执行命令", Icon: TerminalWindow },
  fileChange: { label: "修改文件", Icon: FileText },
  mcpToolCall: { label: "调用 MCP 工具", Icon: Code },
  dynamicToolCall: { label: "调用工具", Icon: Code },
  webSearch: { label: "搜索网页", Icon: MagnifyingGlass },
  collabAgentToolCall: { label: "调用子 Agent", Icon: Robot },
};

const MessageProjectContext = createContext<string | undefined>(undefined);
const MessageEditContext = createContext<(text: string) => void>(() => {});

function MessageLink({ href, onClick, onContextMenu, ...props }: ComponentPropsWithoutRef<"a">) {
  const projectId = useContext(MessageProjectContext);
  const target = messageTargetFromHref(href, projectId);
  return <a
    {...props}
    href={href}
    data-message-target={target?.kind}
    onClick={(event) => {
      onClick?.(event);
      if (!target || event.defaultPrevented) return;
      event.preventDefault();
      void window.rux.system.openMessageTarget(target);
    }}
    onContextMenu={(event) => {
      onContextMenu?.(event);
      if (!target || event.defaultPrevented) return;
      event.preventDefault();
      void window.rux.system.showMessageContextMenu(target);
    }}
  />;
}

function normalizeMessage(message: RuxMessage): any {
  const content = message.parts?.length
    ? message.parts
    : [{ type: "text", text: message.text || "" }];
  return {
    id: message.id,
    role: message.role,
    content,
    createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
    ...(message.role === "assistant" ? {
      status: message.status === "running"
        ? { type: "running" }
        : message.status === "error" || message.status === "incomplete"
          ? { type: "incomplete", reason: "error", error: message.error || message.text }
          : { type: "complete" },
    } : {}),
    metadata: { custom: { agentId: message.agentId || "codex" }, ...(message.role === "assistant" ? { timing: { streamStartTime: new Date(message.createdAt || Date.now()).getTime(), ...(message.completedAt ? { totalStreamTime: Math.max(0, new Date(message.completedAt).getTime() - new Date(message.createdAt || message.completedAt).getTime()) } : {}), totalChunks: message.parts?.length || 0, toolCallCount: message.parts?.filter((part) => part.type === "tool-call").length || 0 } } : {}) },
  };
}

function formatClock(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分钟 ${seconds % 60}秒`;
}

function MessageTimestamp() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  return <time dateTime={createdAt.toISOString()}>{formatClock(createdAt)}</time>;
}

function AssistantTurnMeta() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  const running = useAuiState((state) => state.message.status?.type === "running");
  const timing = useMessageTiming();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const elapsed = timing?.totalStreamTime ?? Math.max(0, now - createdAt.getTime());
  return <div className="assistant-turn-meta"><span>{running ? "已处理" : "用时"} {formatDuration(elapsed)}</span><CaretRight size={16} /></div>;
}

function UserText() {
  return <MessagePartPrimitive.Text />;
}

function AssistantText() {
  return <MarkdownTextPrimitive className="rux-markdown" components={{ a: MessageLink }} />;
}

function ReasoningPart({ text, status }: { text?: string; status?: { type?: string } }) {
  const running = status?.type === "running";
  return (
    <details className={`reasoning-part ${running ? "is-running" : ""}`} open={running}>
      <summary><CircleNotch size={14} className={running ? "spin" : ""} /><span>{running ? "正在思考" : "思考过程"}</span></summary>
      <div className="reasoning-copy">{text}</div>
    </details>
  );
}

function ToolPart({ toolName, args, result, isError, approval, respondToApproval, timing }: Record<string, any>) {
  const definition = toolPresentation[String(toolName) as keyof typeof toolPresentation] || toolPresentation.dynamicToolCall;
  const Icon = definition.Icon;
  const running = result === undefined && !isError;
  const title = args?.command || args?.path || args?.tool || definition.label;
  const output = typeof result === "string" ? result : result?.output || result?.summary || "";
  return (
    <section className={`agent-tool-card ${running ? "is-running" : ""} ${isError ? "is-error" : ""}`}>
      <header>
        <span className="tool-icon"><Icon size={15} /></span>
        <span className="tool-title"><strong>{definition.label}</strong><small title={String(title)}>{String(title)}</small></span>
        {running ? <CircleNotch size={15} className="spin" /> : isError ? <WarningCircle size={15} /> : <Check size={15} />}
      </header>
      {output && <pre>{String(output)}</pre>}
      {timing?.completedAt && timing?.startedAt && <small className="tool-duration">{Math.max(0, timing.completedAt - timing.startedAt)} ms</small>}
      {approval && approval.approved === undefined && !approval.resolution && (
        <div className="tool-approval">
          <span>此操作需要你的批准</span>
          <button type="button" onClick={() => respondToApproval({ approved: false })}>拒绝</button>
          <button type="button" className="primary-button" onClick={() => respondToApproval({ approved: true })}>允许一次</button>
          <button type="button" onClick={() => respondToApproval({ approved: true, optionId: "allow-session" })}>本次会话允许</button>
        </div>
      )}
    </section>
  );
}

function UserMessage() {
  const editMessage = useContext(MessageEditContext);
  const messageText = useAuiState((state) => state.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
  return (
    <MessagePrimitive.Root className="aui-message aui-user-message">
      <div className="aui-user-stack"><div className="aui-user-bubble"><MessagePrimitive.Parts components={{ Text: UserText }} /></div><div className="aui-user-meta"><MessageTimestamp /><ActionBarPrimitive.Root className="aui-user-actions"><ActionBarPrimitive.Copy aria-label="复制用户消息"><Copy size={16} /></ActionBarPrimitive.Copy><button type="button" aria-label="编辑用户消息" title="编辑并重新发送" onClick={() => editMessage(messageText)}><PencilSimple size={16} /></button></ActionBarPrimitive.Root></div></div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-message aui-agent-message">
      <div className="aui-agent-content"><AssistantTurnMeta /><div className="aui-agent-body">
        <AuiIf condition={(state) => state.message.status?.type === "running" && state.message.parts.length === 0}>
          <div className="agent-response-loading" role="status" aria-live="polite"><CircleNotch size={15} className="spin" /><span>Rux 正在准备回复</span><i aria-hidden="true"><b /><b /><b /></i></div>
        </AuiIf>
        <MessagePrimitive.Parts components={{ Text: AssistantText, Reasoning: ReasoningPart, tools: { Fallback: ToolPart } }} />
        <AuiIf condition={(state) => state.message.status?.type === "running" && state.message.parts.length > 0}>
          <div className="agent-turn-status is-running" role="status" aria-live="polite"><CircleNotch size={15} className="spin" /><strong>进行中</strong><span>Rux 正在继续处理</span><i aria-hidden="true"><b /><b /><b /></i></div>
        </AuiIf>
        <AuiIf condition={(state) => state.message.status?.type === "incomplete"}>
          <div className="agent-turn-status is-incomplete" aria-label="本轮状态：未完成"><WarningCircle size={15} weight="fill" /><span>未完成</span></div>
        </AuiIf>
        <MessagePrimitive.Error><span className="aui-message-error">消息执行失败</span></MessagePrimitive.Error>
      </div></div>
    </MessagePrimitive.Root>
  );
}

function ConversationSticky({ enabled, messages, viewportRef }: { enabled: boolean; messages: RuxMessage[]; viewportRef: RefObject<HTMLDivElement | null> }) {
  const turns = useMemo(() => completedStickyTurns(messages), [messages]);
  const [active, setActive] = useState<{ id: string; text: string } | null>(null);
  const navigationTarget = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!enabled || !viewport || !turns.length) { setActive(null); return undefined; }
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewportTop = viewport.getBoundingClientRect().top + 64;
      const elements = new Map(Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).map((element) => [element.dataset.messageId || "", element]));
      const navigating = navigationTarget.current;
      if (navigating && performance.now() < navigating.until) { const targetTurn = turns.find((turn) => turn.id === navigating.id); if (targetTurn) setActive((current) => current?.id === targetTurn.id ? current : targetTurn); return; }
      navigationTarget.current = null;
      let candidate: { id: string; text: string } | null = null;
      for (const turn of turns) {
        const element = elements.get(turn.id);
        if (element && element.getBoundingClientRect().top <= viewportTop) candidate = turn;
      }
      setActive((current) => current?.id === candidate?.id ? current : candidate);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    schedule();
    return () => { viewport.removeEventListener("scroll", schedule); observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [enabled, turns, viewportRef]);
  if (!enabled || !active) return null;
  const previous = adjacentStickyTurn(turns, active.id, -1); const next = adjacentStickyTurn(turns, active.id, 1);
  const scrollTo = (turn: { id: string; text: string }) => { navigationTarget.current = { id: turn.id, until: performance.now() + 750 }; setActive(turn); const viewport = viewportRef.current; const target = viewport?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(turn.id)}"]`); target?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return <div className="conversation-sticky"><div className="conversation-sticky-card"><button type="button" className="conversation-sticky-current" aria-label={`返回当前轮问题：${active.text}`} onClick={() => scrollTo(active)}><span>上一轮</span><strong>{active.text}</strong></button><div className="conversation-sticky-nav" role="group" aria-label="切换对话轮次"><button type="button" aria-label="切换到上一轮" title="上一轮" disabled={!previous} onClick={() => previous && scrollTo(previous)}><ArrowUp size={15} /></button><button type="button" aria-label="切换到下一轮" title="下一轮" disabled={!next} onClick={() => next && scrollTo(next)}><ArrowDown size={15} /></button></div></div></div>;
}

function AgentSelector({ agents, selectedAgent, onSelectAgent, runtimeProgress, open, onToggle, onClose, buttonRef }: { agents: AgentDefinition[]; selectedAgent: AgentId; onSelectAgent: (agentId: AgentId) => void; runtimeProgress: RuntimeProgress; open: boolean; onToggle: () => void; onClose: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const current = agents.find((agent) => agent.id === selectedAgent) || agents[0];
  return (
    <span className="agent-selector-wrap" data-overlay-scope>
      <button ref={buttonRef} type="button" className="composer-menu agent-selector-button" aria-label="选择 Agent" onClick={onToggle} aria-expanded={open} aria-haspopup="menu">
        <Robot size={15} />{current?.name || "Codex"}<CaretDown size={12} />
      </button>
      {open && <span className="agent-selector-popover" role="menu">
        <strong>底座 Agent</strong>
        {agents.map((agent) => (
          <button
            type="button"
            key={agent.id}
            className={agent.id === selectedAgent ? "is-selected" : ""}
            disabled={!agent.integrated}
            onClick={() => { onSelectAgent(agent.id); onClose(); }}
          >
            <span><b>{agent.name}</b><small>{runtimeProgress?.[agent.id]?.state === "downloading" ? `正在下载 ${runtimeProgress[agent.id].percent}%` : !agent.installed ? `首次使用自动下载 · ${agent.version}` : agent.integrated ? `已就绪 · ${agent.version}` : "适配器不可用"}</small>{runtimeProgress?.[agent.id]?.state === "downloading" && <i className="runtime-download-track"><i style={{ width: `${runtimeProgress[agent.id].percent}%` }} /></i>}</span>
            {agent.id === selectedAgent && <Check size={14} />}
          </button>
        ))}
      </span>}
    </span>
  );
}

function AgentModeSelector({ agent, mode, onMode, open, onToggle, onClose, buttonRef }: { agent?: AgentDefinition; mode: string; onMode: (mode: string) => void; open: boolean; onToggle: () => void; onClose: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const current = agent?.modes?.find((item) => item.id === mode) || agent?.modes?.[0];
  if (!agent?.modes?.length) return null;
  return (
    <span className="agent-selector-wrap" data-overlay-scope>
      <button ref={buttonRef} type="button" className="composer-menu" aria-label="选择 Agent 模式" onClick={onToggle} aria-expanded={open} aria-haspopup="menu">{current?.label || "默认"}<CaretDown size={12} /></button>
      {open && <span className="agent-mode-popover" role="menu">
        {agent.modes.map((item) => <button type="button" className={item.id === current?.id ? "is-selected" : ""} key={item.id} onClick={() => { onMode(item.id); onClose(); }}>{item.label}{item.id === current?.id && <Check size={13} />}</button>)}
      </span>}
    </span>
  );
}

export default function RuxAssistantThread({
  messages,
  running,
  emptyTitle,
  projectId,
  onNewMessage,
  onCancel,
  onApproval,
  conversationSticky,
  agents,
  runtimeProgress,
  selectedAgent,
  onSelectAgent,
  agentMode,
  onAgentMode,
  modelLabel,
  reasoningLabel,
  permissionLabel,
  permissionMode,
  permissionDanger = false,
  showPermission = true,
  modelOpen,
  sandboxOpen,
  modelPopover,
  permissionPopover,
  activeOverlay,
  onOverlayChange,
  onToggleModel,
  onToggleSandbox,
  attachments,
  showAttachments = true,
  webSearch = false,
  showWebSearch = false,
  onToggleWebSearch,
  draftKey,
  draftText,
  onDraftTextChange,
  onAddFiles,
  onRemoveAttachment,
  listening,
  onVoice,
  workspaceSummary,
}: Props) {
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: normalizeMessage,
    isRunning: running,
    onNew: async (message) => {
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
      if (text) await onNewMessage(text);
    },
    onCancel: async () => { await onCancel(); },
    onRespondToToolApproval: async ({ approvalId, approved, optionId }) => { await onApproval({ approvalId, approved, optionId }); },
  });
  const selectedDefinition = useMemo(() => agents.find((agent) => agent.id === selectedAgent), [agents, selectedAgent]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const modeTrigger = useRef<HTMLButtonElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const sandboxTrigger = useRef<HTMLButtonElement>(null);
  const previousOverlay = useRef<OverlayId | null>(null);
  const composerDraftRef = useRef({ key: "", text: "" });
  useEffect(() => {
    if (composerDraftRef.current.key === draftKey && composerDraftRef.current.text === draftText) return;
    composerDraftRef.current = { key: draftKey, text: draftText };
    runtime.thread.composer.setText(draftText);
  }, [draftKey, draftText, runtime]);
  useEffect(() => {
    const previous = previousOverlay.current;
    if (previous && !activeOverlay) ({ agents: agentTrigger, "agent-mode": modeTrigger, "run-settings": modelTrigger, sandbox: sandboxTrigger }[previous]).current?.focus();
    previousOverlay.current = activeOverlay;
  }, [activeOverlay]);
  useEffect(() => {
    if (!activeOverlay) return undefined;
    const closeOnOutside = (event: PointerEvent) => { const target = event.target; if (!(target instanceof Element) || !target.closest("[data-overlay-scope]")) onOverlayChange(null); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onOverlayChange(null); } };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [activeOverlay, onOverlayChange]);
  const editMessage = (text: string) => { composerDraftRef.current = { key: draftKey, text }; onDraftTextChange(text); runtime.thread.composer.setText(text); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus()); };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MessageProjectContext.Provider value={projectId}>
      <MessageEditContext.Provider value={editMessage}>
      <ThreadPrimitive.Root className="aui-thread-root">
        <ConversationSticky enabled={conversationSticky} messages={messages} viewportRef={viewportRef} />
        <ThreadPrimitive.Viewport ref={viewportRef} className="aui-thread-viewport">
          <ThreadPrimitive.Empty>
            <div className="conversation-empty"><Robot size={30} /><h2>{emptyTitle}</h2><p>输入任务后，Rux 将显示 Agent 的流式文本、思考与工具执行过程。</p></div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {workspaceSummary}
        </ThreadPrimitive.Viewport>
        <ThreadPrimitive.ScrollToBottom className="aui-scroll-bottom" aria-label="滚动到底部"><ArrowDown size={16} /></ThreadPrimitive.ScrollToBottom>
        <ComposerPrimitive.Root className="composer-wrap aui-composer-wrap">
          <div className="composer">
            {runtimeProgress?.[selectedAgent] && !["ready", "error"].includes(runtimeProgress[selectedAgent].state) && <div className="runtime-inline-progress"><CircleNotch size={13} className="spin" /><span>{runtimeProgress[selectedAgent].state === "downloading" ? `正在下载 ${agents.find((agent) => agent.id === selectedAgent)?.name || selectedAgent} 运行时` : "正在验证并安装运行时"}</span><em>{runtimeProgress[selectedAgent].percent || 0}%</em><i><i style={{ width: `${runtimeProgress[selectedAgent].percent || 4}%` }} /></i></div>}
            {runtimeProgress?.[selectedAgent]?.state === "error" && <div className="runtime-inline-progress is-error"><WarningCircle size={13} /><span>{runtimeProgress[selectedAgent].message || "运行时下载失败"}</span></div>}
            {showAttachments && attachments.length > 0 && <div className="attachment-list">{attachments.map((path) => <span key={path}><Paperclip size={13} />{path.split(/[\\/]/).pop()}<button type="button" onClick={() => onRemoveAttachment(path)}><X size={12} /></button></span>)}</div>}
            <ComposerPrimitive.Input className="aui-composer-input" aria-label="消息" placeholder="向 Rux 发送消息" rows={2} onChange={(event) => { composerDraftRef.current = { key: draftKey, text: event.currentTarget.value }; onDraftTextChange(event.currentTarget.value); }} />
            <div className="composer-controls">
              <div className="composer-left">
                {showAttachments && <button type="button" className="icon-button" aria-label="添加文件" onClick={onAddFiles}><Plus size={19} /></button>}
                {showWebSearch && <button type="button" className={`icon-button ${webSearch ? "is-active" : ""}`} aria-label={webSearch ? "关闭网页搜索" : "启用网页搜索"} title={webSearch ? "网页搜索已启用" : "启用网页搜索"} onClick={onToggleWebSearch}><Globe size={18} /></button>}
                {showPermission && <span className="scope-menu-wrap" data-overlay-scope><button ref={sandboxTrigger} type="button" className={`scope-button ${permissionDanger ? "" : "neutral"}`} data-permission-mode={permissionMode} aria-label="操作批准方式" onClick={onToggleSandbox} aria-expanded={sandboxOpen} aria-haspopup="menu"><PermissionModeIcon mode={permissionMode} size={16} />{permissionLabel}<CaretDown size={12} /></button>{sandboxOpen && permissionPopover}</span>}
              </div>
              <div className="composer-right">
                <AgentSelector agents={agents} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} runtimeProgress={runtimeProgress} open={activeOverlay === "agents"} onToggle={() => onOverlayChange(activeOverlay === "agents" ? null : "agents")} onClose={() => onOverlayChange(null)} buttonRef={agentTrigger} />
                <AgentModeSelector agent={selectedDefinition} mode={agentMode} onMode={onAgentMode} open={activeOverlay === "agent-mode"} onToggle={() => onOverlayChange(activeOverlay === "agent-mode" ? null : "agent-mode")} onClose={() => onOverlayChange(null)} buttonRef={modeTrigger} />
                <span className="run-settings-wrap" data-overlay-scope><button ref={modelTrigger} type="button" aria-label="切换模型、推理强度和速度" className={`composer-menu run-settings-trigger ${modelOpen ? "is-active" : ""}`} onClick={onToggleModel} aria-expanded={modelOpen} aria-haspopup="dialog"><strong>{compactModelName(modelLabel)}</strong><span>{reasoningLabel}</span><CaretDown size={13} /></button>{modelOpen && modelPopover}</span>
                <button type="button" className={`icon-button ${listening ? "is-active" : ""}`} aria-label="语音输入" onClick={onVoice}><Microphone size={18} /></button>
                <ThreadPrimitive.If running>
                  <ComposerPrimitive.Cancel className="send-button stop-button" aria-label="停止"><Stop size={15} weight="fill" /></ComposerPrimitive.Cancel>
                </ThreadPrimitive.If>
                <ThreadPrimitive.If running={false}>
                  <ComposerPrimitive.Send className="send-button" aria-label="发送"><ArrowUp size={19} weight="bold" /></ComposerPrimitive.Send>
                </ThreadPrimitive.If>
              </div>
            </div>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
      </MessageEditContext.Provider>
      </MessageProjectContext.Provider>
    </AssistantRuntimeProvider>
  );
}
