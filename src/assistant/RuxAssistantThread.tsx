import { Button, IconButton, ChoiceList, ChoiceItem } from "../ui";
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
  PencilSimple,
  Plus,
  Robot,
  Stop,
  TerminalWindow,
  WarningCircle,
  Wrench,
  Sparkle,
  GitDiff,
} from "../ui/icons";
import type { RuxMessage } from "../renderer/messages";
import { adjacentStickyTurn, completedStickyTurns } from "../renderer/messages";
import { messageTargetFromHref } from "../renderer/message-targets";
import type { AgentId } from "../renderer/types";
import FloatingPopover from "../components/FloatingPopover";
import PermissionModeIcon from "../components/PermissionModeIcon";
import AttachmentList from "./AttachmentList";
import TurnSignature, { turnModelName } from "./TurnSignature";
import type { TurnInfo } from "../shared/turn-info";

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
  attachments: string[]; attachmentError?: string; showAttachments?: boolean; webSearch?: boolean; showWebSearch?: boolean; onToggleWebSearch: () => void;
  draftKey: string; draftText: string; onDraftTextChange: (text: string) => void;
  onImportImages?: (files: File[]) => Promise<void>; importingImages?: boolean;
  voicePhase?: "idle" | "preparing" | "recording" | "transcribing"; voiceSeconds?: number; onCancelVoice?: () => void;
  onAddFiles: () => void; onRemoveAttachment: (path: string) => void; listening: boolean; showVoice?: boolean; onVoice: () => void;
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
    metadata: { custom: { agentId: message.agentId, attachments: message.attachments || [], turnInfo: message.turnInfo || (message.completedAt && message.createdAt ? { startedAt: Date.parse(message.createdAt), completedAt: Date.parse(message.completedAt) } : undefined) } },
  };
}

function formatClock(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function MessageTimestamp() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  return <time dateTime={createdAt.toISOString()}>{formatClock(createdAt)}</time>;
}

function AssistantTurnMeta() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  const running = useAuiState((state) => state.message.status?.type === "running");
  const complete = useAuiState((state) => state.message.status?.type === "complete");
  const info = useAuiState((state) => state.message.metadata.custom?.turnInfo as TurnInfo | undefined);
  const agentId = useAuiState((state) => state.message.metadata.custom?.agentId as string | undefined);
  return <div className="assistant-turn-footer" aria-label={`本轮状态：${running ? "进行中" : complete ? "已完成" : "未完成"}`}>
    <TurnSignature info={info} agentId={agentId} createdAt={createdAt} running={running} />
    <ActionBarPrimitive.Root className="turn-copy-action"><ActionBarPrimitive.Copy asChild><IconButton label="复制回复" icon="copy" /></ActionBarPrimitive.Copy></ActionBarPrimitive.Root>
  </div>;
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
      <summary><CircleNotch size="sm" className={running ? "spin" : ""} /><span>{running ? "正在思考" : "思考过程"}</span></summary>
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
  const changes = Array.isArray(args?.changes) ? args.changes : Array.isArray(result?.changes) ? result.changes : [];
  if (toolName === "fileChange" && !running && !isError && !approval && changes.length) return <details className="turn-file-changes"><summary>{changes.length} 个文件已更新<CaretRight size="sm" /></summary><ul>{changes.map((change: any, index: number) => <li key={`${change.path}:${index}`}><MessageLink href={String(change.path || "")}>{change.path || "文件"}</MessageLink></li>)}</ul></details>;
  return (
    <details className={`agent-tool-card ${running ? "is-running" : ""} ${isError ? "is-error" : ""}`} open={running || Boolean(approval && approval.approved === undefined && !approval.resolution)}>
      <summary>
        <span className="tool-icon"><Icon size="sm" /></span>
        <span className="tool-title"><strong>{definition.label}</strong><small title={String(title)}>{String(title)}</small></span>
        {running ? <CircleNotch size="sm" className="spin" /> : isError ? <WarningCircle size="sm" /> : <Check size="sm" />}
      </summary>
      {output && <pre>{String(output)}</pre>}
      {timing?.completedAt && timing?.startedAt && <small className="tool-duration">{Math.max(0, timing.completedAt - timing.startedAt)} ms</small>}
      {approval && approval.approved === undefined && !approval.resolution && (
        <div className="tool-approval">
          <span>此操作需要你的批准</span>
          <Button variant="plain" type="button" onClick={() => respondToApproval({ approved: false })}>拒绝</Button>
          <Button variant="primary" type="button" className="primary-button" onClick={() => respondToApproval({ approved: true })}>允许一次</Button>
          <Button variant="plain" type="button" onClick={() => respondToApproval({ approved: true, optionId: "allow-session" })}>本次会话允许</Button>
        </div>
      )}
    </details>
  );
}

function UserMessage() {
  const editMessage = useContext(MessageEditContext);
  const attachments = useAuiState((state) => state.message.metadata.custom?.attachments as string[] | undefined);
  const messageText = useAuiState((state) => state.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
  return (
    <MessagePrimitive.Root className="aui-message aui-user-message">
      <div className="aui-user-stack"><div className="aui-user-bubble"><MessagePrimitive.Parts components={{ Text: UserText }} /></div><AttachmentList paths={attachments || []} /><div className="aui-user-meta"><MessageTimestamp /><ActionBarPrimitive.Root className="aui-user-actions"><ActionBarPrimitive.Copy asChild><IconButton label="复制用户消息" icon="copy" /></ActionBarPrimitive.Copy><IconButton label="编辑用户消息" icon="edit" onClick={() => editMessage(messageText)} /></ActionBarPrimitive.Root></div></div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-message aui-agent-message">
      <div className="aui-agent-content"><div className="aui-agent-body">
        <AuiIf condition={(state) => state.message.status?.type === "running" && state.message.parts.length === 0}>
          <div className="agent-response-loading" role="status" aria-live="polite"><CircleNotch size="sm" className="spin" /><span>Rux 正在准备回复</span><i aria-hidden="true"><b /><b /><b /></i></div>
        </AuiIf>
        <MessagePrimitive.Parts components={{ Text: AssistantText, Reasoning: ReasoningPart, tools: { Fallback: ToolPart } }} />
        <AuiIf condition={(state) => state.message.status?.type === "running" && state.message.parts.length > 0}>
          <div className="agent-turn-status is-running" role="status" aria-live="polite"><CircleNotch size="sm" className="spin" /><strong>进行中</strong><span>Rux 正在继续处理</span><i aria-hidden="true"><b /><b /><b /></i></div>
        </AuiIf>
        <AuiIf condition={(state) => state.message.status?.type === "incomplete"}>
          <div className="agent-turn-status is-incomplete" aria-label="本轮状态：未完成"><WarningCircle size="sm" variant="solid" /><span>未完成</span></div>
        </AuiIf>
        <MessagePrimitive.Error><span className="aui-message-error">消息执行失败</span></MessagePrimitive.Error>
      </div><AssistantTurnMeta /></div>
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
  const scrollTo = (turn: { id: string; text: string }) => { navigationTarget.current = { id: turn.id, until: performance.now() + 750 }; setActive(turn); const viewport = viewportRef.current; const target = viewport?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(turn.id)}"]`); target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); };
  return <div className="conversation-sticky"><div className="conversation-sticky-card"><Button variant="plain" type="button" className="conversation-sticky-current" aria-label={`返回当前轮问题：${active.text}`} onClick={() => scrollTo(active)}><span>上一轮</span><strong>{active.text}</strong></Button><div className="conversation-sticky-nav" role="group" aria-label="切换对话轮次"><Button variant="plain" type="button" aria-label="切换到上一轮" title="上一轮" disabled={!previous} onClick={() => previous && scrollTo(previous)}><ArrowUp size="sm" /></Button><Button variant="plain" type="button" aria-label="切换到下一轮" title="下一轮" disabled={!next} onClick={() => next && scrollTo(next)}><ArrowDown size="sm" /></Button></div></div></div>;
}

function AgentSelector({ agents, selectedAgent, onSelectAgent, runtimeProgress, open, onToggle, onClose, buttonRef }: { agents: AgentDefinition[]; selectedAgent: AgentId; onSelectAgent: (agentId: AgentId) => void; runtimeProgress: RuntimeProgress; open: boolean; onToggle: () => void; onClose: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const current = agents.find((agent) => agent.id === selectedAgent) || agents[0];
  return (
    <span className="agent-selector-wrap" data-overlay-scope data-overlay-id="agents">
      <Button variant="plain" ref={buttonRef} type="button" className="composer-menu agent-selector-button" aria-label="选择 Agent" onClick={onToggle} aria-expanded={open} aria-haspopup="menu">
        {current?.name || "Codex"}<CaretDown size="xs" />
      </Button>
      {open && <FloatingPopover anchorRef={buttonRef} scope="agents" onDismiss={onClose}><ChoiceList className="agent-selector-popover" aria-label="Agent">
        <strong>底座 Agent</strong>
        {agents.map((agent) => (
          <ChoiceItem
            type="button"
            checked={agent.id === selectedAgent}
            key={agent.id}
            className={agent.id === selectedAgent ? "is-selected" : ""}
            disabled={!agent.integrated}
            onClick={() => { onSelectAgent(agent.id); onClose(); }}
          >
            <span><b>{agent.name}</b><small>{runtimeProgress?.[agent.id]?.state === "downloading" ? `正在下载 ${runtimeProgress[agent.id].percent}%` : !agent.installed ? `首次使用自动下载 · ${agent.version}` : agent.integrated ? `已就绪 · ${agent.version}` : "适配器不可用"}</small>{runtimeProgress?.[agent.id]?.state === "downloading" && <i className="runtime-download-track"><i style={{ width: `${runtimeProgress[agent.id].percent}%` }} /></i>}</span>
            {agent.id === selectedAgent && <Check size="sm" />}
          </ChoiceItem>
        ))}
      </ChoiceList></FloatingPopover>}
    </span>
  );
}

function AgentModeSelector({ agent, mode, onMode, open, onToggle, onClose, buttonRef }: { agent?: AgentDefinition; mode: string; onMode: (mode: string) => void; open: boolean; onToggle: () => void; onClose: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const current = agent?.modes?.find((item) => item.id === mode) || agent?.modes?.[0];
  if (!agent?.modes?.length) return null;
  return (
    <span className="agent-selector-wrap" data-overlay-scope data-overlay-id="agent-mode">
      <Button variant="plain" ref={buttonRef} type="button" className="composer-menu" aria-label="选择 Agent 模式" onClick={onToggle} aria-expanded={open} aria-haspopup="menu">{current?.label || "默认"}<CaretDown size="xs" /></Button>
      {open && <FloatingPopover anchorRef={buttonRef} scope="agent-mode" width="xs" onDismiss={onClose}><ChoiceList className="agent-mode-popover" aria-label="Agent 模式">
        {agent.modes.map((item) => <ChoiceItem checked={item.id === current?.id} className={item.id === current?.id ? "is-selected" : ""} key={item.id} onClick={() => { onMode(item.id); onClose(); }}>{item.label}{item.id === current?.id && <Check size="xs" />}</ChoiceItem>)}
      </ChoiceList></FloatingPopover>}
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
  attachmentError = "",
  showAttachments = true,
  webSearch = false,
  showWebSearch = false,
  onToggleWebSearch,
  draftKey,
  draftText,
  onDraftTextChange,
  onAddFiles,
  onImportImages,
  importingImages = false,
  onRemoveAttachment,
  listening,
  voicePhase = "idle",
  voiceSeconds = 0,
  onCancelVoice,
  showVoice = true,
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
  const threadRootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const measure = () => threadRootRef.current?.style.setProperty("--composer-height", `${Math.ceil(composer.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, []);
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const modeTrigger = useRef<HTMLButtonElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const sandboxTrigger = useRef<HTMLButtonElement>(null);
  const composerDraftRef = useRef({ key: "", text: "" });
  useEffect(() => {
    if (composerDraftRef.current.key === draftKey && composerDraftRef.current.text === draftText) return;
    composerDraftRef.current = { key: draftKey, text: draftText };
    runtime.thread.composer.setText(draftText);
  }, [draftKey, draftText, runtime]);
  const editMessage = (text: string) => { composerDraftRef.current = { key: draftKey, text }; onDraftTextChange(text); runtime.thread.composer.setText(text); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus()); };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MessageProjectContext.Provider value={projectId}>
      <MessageEditContext.Provider value={editMessage}>
      <ThreadPrimitive.Root ref={threadRootRef} className="aui-thread-root">
        <ConversationSticky enabled={conversationSticky} messages={messages} viewportRef={viewportRef} />
        <ThreadPrimitive.Viewport ref={viewportRef} className="aui-thread-viewport">
          <ThreadPrimitive.Empty>
            <div className="conversation-empty"><Robot size="xl" className="conversation-empty-mark" /><h2>想构建些什么？</h2><p>{emptyTitle}</p><div className="conversation-starters" aria-label="任务建议">{[
              { label: "了解代码库", prompt: "帮我梳理这个项目的结构和主要功能。", Icon: Code },
              { label: "实现新功能", prompt: "我想为这个项目添加一个新功能：", Icon: Sparkle },
              { label: "审查代码", prompt: "帮我审查当前代码变更，找出潜在问题。", Icon: GitDiff },
              { label: "修复问题", prompt: "帮我定位并修复这个问题：", Icon: Wrench },
            ].map(({ label, prompt, Icon }) => <Button variant="plain" type="button" key={label} onClick={() => editMessage(prompt)}><Icon size="sm" /><span>{label}</span></Button>)}</div></div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {workspaceSummary}
        </ThreadPrimitive.Viewport>
        <ThreadPrimitive.ScrollToBottom className="aui-scroll-bottom" aria-label="滚动到底部"><ArrowDown size="sm" /></ThreadPrimitive.ScrollToBottom>
        <ComposerPrimitive.Root ref={composerRef} className="composer-wrap aui-composer-wrap"
          onPasteCapture={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
            if (!files.length || !onImportImages) return;
            event.preventDefault(); event.stopPropagation(); void onImportImages(files);
          }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault(); event.stopPropagation(); void onImportImages?.(Array.from(event.dataTransfer.files));
          }}>
          {importingImages && <div className="runtime-inline-progress" role="status"><CircleNotch size="xs" className="spin" />正在添加图片…</div>}
          <div className="composer">
            {voicePhase !== "idle" && <div className="voice-recording-bar" role="status"><span>{voicePhase === "recording" ? `正在录音 ${voiceSeconds} 秒 · 点击麦克风结束并转写` : voicePhase === "preparing" ? "正在准备麦克风…" : "正在使用系统语音转写…"}</span><Button variant="plain" onClick={onCancelVoice}>取消</Button></div>}
            {runtimeProgress?.[selectedAgent] && !["ready", "error"].includes(runtimeProgress[selectedAgent].state) && <div className="runtime-inline-progress"><CircleNotch size="xs" className="spin" /><span>{runtimeProgress[selectedAgent].state === "downloading" ? `正在下载 ${agents.find((agent) => agent.id === selectedAgent)?.name || selectedAgent} 运行时` : "正在验证并安装运行时"}</span><em>{runtimeProgress[selectedAgent].percent || 0}%</em><i><i style={{ width: `${runtimeProgress[selectedAgent].percent || 4}%` }} /></i></div>}
            {runtimeProgress?.[selectedAgent]?.state === "error" && <div className="runtime-inline-progress is-error"><WarningCircle size="xs" /><span>{runtimeProgress[selectedAgent].message || "运行时下载失败"}</span></div>}
            {showAttachments && <AttachmentList paths={attachments} onRemove={onRemoveAttachment} />}
            {attachmentError && <p className="composer-attachment-error" role="alert">{attachmentError}</p>}
            <ComposerPrimitive.Input className="aui-composer-input" aria-label="消息" placeholder="继续对话…" rows={2} onKeyDownCapture={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (voicePhase !== "idle" || importingImages || attachments.length) {
                event.preventDefault(); event.stopPropagation();
                if (!attachmentError && voicePhase === "idle" && !importingImages && !running) void onNewMessage(draftText);
              }
            }} onChange={(event) => { composerDraftRef.current = { key: draftKey, text: event.currentTarget.value }; onDraftTextChange(event.currentTarget.value); }} />
            <div className="composer-controls">
              <div className="composer-left">
                {showAttachments && <IconButton label="添加文件" icon="attachment" onClick={onAddFiles} />}
                {showWebSearch && <IconButton label={webSearch ? "关闭网页搜索" : "启用网页搜索"} icon="browser" active={webSearch} onClick={onToggleWebSearch} />}
                {showPermission && <span className="scope-menu-wrap" data-overlay-scope data-overlay-id="sandbox"><Button variant="plain" ref={sandboxTrigger} type="button" className={`scope-button ${permissionDanger ? "" : "neutral"}`} data-permission-mode={permissionMode} aria-label="操作批准方式" title={permissionLabel} onClick={onToggleSandbox} aria-expanded={sandboxOpen} aria-haspopup="menu"><PermissionModeIcon mode={permissionMode} size="sm" /><span className="permission-label">{permissionLabel}</span><CaretDown size="xs" /></Button>{sandboxOpen && <FloatingPopover anchorRef={sandboxTrigger} scope="sandbox" width="lg" align="start" onDismiss={() => onOverlayChange(null)}>{permissionPopover}</FloatingPopover>}</span>}
              </div>
              <div className="composer-right">
                <AgentSelector agents={agents} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} runtimeProgress={runtimeProgress} open={activeOverlay === "agents"} onToggle={() => onOverlayChange(activeOverlay === "agents" ? null : "agents")} onClose={() => onOverlayChange(null)} buttonRef={agentTrigger} />
                <AgentModeSelector agent={selectedDefinition} mode={agentMode} onMode={onAgentMode} open={activeOverlay === "agent-mode"} onToggle={() => onOverlayChange(activeOverlay === "agent-mode" ? null : "agent-mode")} onClose={() => onOverlayChange(null)} buttonRef={modeTrigger} />
                <span className="run-settings-wrap" data-overlay-scope data-overlay-id="run-settings"><Button variant="plain" ref={modelTrigger} type="button" aria-label="切换模型、推理强度和速度" className={`composer-menu run-settings-trigger ${modelOpen ? "is-active" : ""}`} onClick={onToggleModel} aria-expanded={modelOpen} aria-haspopup="dialog"><strong>{turnModelName({ modelLabel })}</strong><span>{reasoningLabel}</span><CaretDown size="xs" /></Button>{modelOpen && <FloatingPopover anchorRef={modelTrigger} scope="run-settings" width="lg" onDismiss={() => onOverlayChange(null)}>{modelPopover}</FloatingPopover>}</span>
                {showVoice && <IconButton label={voicePhase === "recording" ? "结束录音并转写" : voicePhase === "idle" ? "语音输入" : "取消语音输入"} icon={voicePhase === "transcribing" ? "loading" : "microphone"} active={listening} onClick={onVoice} />}
                <ThreadPrimitive.If running>
                  <ComposerPrimitive.Cancel asChild><IconButton label="停止" icon="stop" iconVariant="solid" variant="primary" size="lg" shape="round" className="send-button stop-button" /></ComposerPrimitive.Cancel>
                </ThreadPrimitive.If>
                <ThreadPrimitive.If running={false}>
                  {attachments.length ? <IconButton label="发送" icon="send" variant="primary" size="lg" shape="round" className="send-button" disabled={Boolean(attachmentError) || importingImages || voicePhase !== "idle"} onClick={() => void onNewMessage(draftText)} /> : <ComposerPrimitive.Send asChild disabled={Boolean(attachmentError) || importingImages || voicePhase !== "idle"}><IconButton label="发送" icon="send" variant="primary" size="lg" shape="round" className="send-button" /></ComposerPrimitive.Send>}
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
