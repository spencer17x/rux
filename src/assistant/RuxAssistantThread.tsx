import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  Check,
  CircleNotch,
  Code,
  FileText,
  Globe,
  MagnifyingGlass,
  Microphone,
  Paperclip,
  Plus,
  Robot,
  ShieldCheck,
  Stop,
  TerminalWindow,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { RuxMessage } from "../renderer/messages";
import type { AgentId } from "../renderer/types";

type AgentDefinition = { id: AgentId; name: string; installed: boolean; integrated: boolean; version: string; modes?: Array<{ id: string; label: string }> };
type RuntimeProgress = Record<string, { state: string; percent?: number; message?: string }>;
type ApprovalResponse = { approvalId: string; approved: boolean; optionId?: string };
type Props = {
  messages: RuxMessage[]; running: boolean; emptyTitle: string; onNewMessage: (text: string) => Promise<unknown>; onCancel: () => Promise<unknown>; onApproval: (response: ApprovalResponse) => Promise<unknown>;
  agents: AgentDefinition[]; runtimeProgress: RuntimeProgress; selectedAgent: AgentId; onSelectAgent: (agentId: AgentId) => void; agentMode: string; onAgentMode: (mode: string) => void;
  modelLabel: string; reasoningLabel: string; permissionLabel: string; showPermission?: boolean; modelOpen: "models" | "reasoning" | null; sandboxOpen: boolean;
  modelPopover: ReactNode; permissionPopover: ReactNode; onToggleModel: (mode: "models" | "reasoning") => void; onToggleSandbox: () => void;
  attachments: string[]; showAttachments?: boolean; webSearch?: boolean; showWebSearch?: boolean; onToggleWebSearch: () => void; voiceTranscript: string;
  onAddFiles: () => void; onRemoveAttachment: (path: string) => void; listening: boolean; onVoice: () => void;
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
        : message.status === "error"
          ? { type: "incomplete", reason: "error", error: message.error || message.text }
          : { type: "complete" },
    } : {}),
    metadata: { custom: { agentId: message.agentId || "codex" } },
  };
}

function UserText() {
  return <MessagePartPrimitive.Text />;
}

function AssistantText() {
  return <MarkdownTextPrimitive className="rux-markdown" />;
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
  return (
    <MessagePrimitive.Root className="aui-message aui-user-message">
      <div className="aui-user-bubble"><MessagePrimitive.Parts components={{ Text: UserText }} /></div>
      <span className="avatar">S</span>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-message aui-agent-message">
      <span className="avatar avatar-dark">R</span>
      <div className="aui-agent-content">
        <MessagePrimitive.Parts components={{ Text: AssistantText, Reasoning: ReasoningPart, tools: { Fallback: ToolPart } }} />
        <MessagePrimitive.Error><span className="aui-message-error">消息执行失败</span></MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
}

function AgentSelector({ agents, selectedAgent, onSelectAgent, runtimeProgress }: { agents: AgentDefinition[]; selectedAgent: AgentId; onSelectAgent: (agentId: AgentId) => void; runtimeProgress: RuntimeProgress }) {
  const [open, setOpen] = useState(false);
  const current = agents.find((agent) => agent.id === selectedAgent) || agents[0];
  return (
    <span className="agent-selector-wrap">
      <button type="button" className="composer-menu agent-selector-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Robot size={15} />{current?.name || "Codex"}<CaretDown size={12} />
      </button>
      {open && <span className="agent-selector-popover">
        <strong>底座 Agent</strong>
        {agents.map((agent) => (
          <button
            type="button"
            key={agent.id}
            className={agent.id === selectedAgent ? "is-selected" : ""}
            disabled={!agent.integrated}
            onClick={() => { onSelectAgent(agent.id); setOpen(false); }}
          >
            <span><b>{agent.name}</b><small>{runtimeProgress?.[agent.id]?.state === "downloading" ? `正在下载 ${runtimeProgress[agent.id].percent}%` : !agent.installed ? `首次使用自动下载 · ${agent.version}` : agent.integrated ? `已就绪 · ${agent.version}` : "适配器不可用"}</small>{runtimeProgress?.[agent.id]?.state === "downloading" && <i className="runtime-download-track"><i style={{ width: `${runtimeProgress[agent.id].percent}%` }} /></i>}</span>
            {agent.id === selectedAgent && <Check size={14} />}
          </button>
        ))}
      </span>}
    </span>
  );
}

function AgentModeSelector({ agent, mode, onMode }: { agent?: AgentDefinition; mode: string; onMode: (mode: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = agent?.modes?.find((item) => item.id === mode) || agent?.modes?.[0];
  if (!agent?.modes?.length) return null;
  return (
    <span className="agent-selector-wrap">
      <button type="button" className="composer-menu" onClick={() => setOpen((value) => !value)}>{current?.label || "默认"}<CaretDown size={12} /></button>
      {open && <span className="agent-mode-popover">
        {agent.modes.map((item) => <button type="button" className={item.id === current?.id ? "is-selected" : ""} key={item.id} onClick={() => { onMode(item.id); setOpen(false); }}>{item.label}{item.id === current?.id && <Check size={13} />}</button>)}
      </span>}
    </span>
  );
}

export default function RuxAssistantThread({
  messages,
  running,
  emptyTitle,
  onNewMessage,
  onCancel,
  onApproval,
  agents,
  runtimeProgress,
  selectedAgent,
  onSelectAgent,
  agentMode,
  onAgentMode,
  modelLabel,
  reasoningLabel,
  permissionLabel,
  showPermission = true,
  modelOpen,
  sandboxOpen,
  modelPopover,
  permissionPopover,
  onToggleModel,
  onToggleSandbox,
  attachments,
  showAttachments = true,
  webSearch = false,
  showWebSearch = false,
  onToggleWebSearch,
  voiceTranscript,
  onAddFiles,
  onRemoveAttachment,
  listening,
  onVoice,
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
  useEffect(() => {
    if (voiceTranscript) runtime.thread.composer.setText(voiceTranscript);
  }, [runtime, voiceTranscript]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="aui-thread-root">
        <ThreadPrimitive.Viewport className="aui-thread-viewport">
          <ThreadPrimitive.Empty>
            <div className="conversation-empty"><Robot size={30} /><h2>{emptyTitle}</h2><p>输入任务后，Rux 将显示 Agent 的流式文本、思考与工具执行过程。</p></div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        <ThreadPrimitive.ScrollToBottom className="aui-scroll-bottom" aria-label="滚动到底部"><ArrowDown size={16} /></ThreadPrimitive.ScrollToBottom>
        <ComposerPrimitive.Root className="composer-wrap aui-composer-wrap">
          {modelOpen && modelPopover}
          <div className="composer">
            {runtimeProgress?.[selectedAgent] && !["ready", "error"].includes(runtimeProgress[selectedAgent].state) && <div className="runtime-inline-progress"><CircleNotch size={13} className="spin" /><span>{runtimeProgress[selectedAgent].state === "downloading" ? `正在下载 ${agents.find((agent) => agent.id === selectedAgent)?.name || selectedAgent} 运行时` : "正在验证并安装运行时"}</span><em>{runtimeProgress[selectedAgent].percent || 0}%</em><i><i style={{ width: `${runtimeProgress[selectedAgent].percent || 4}%` }} /></i></div>}
            {runtimeProgress?.[selectedAgent]?.state === "error" && <div className="runtime-inline-progress is-error"><WarningCircle size={13} /><span>{runtimeProgress[selectedAgent].message || "运行时下载失败"}</span></div>}
            {showAttachments && attachments.length > 0 && <div className="attachment-list">{attachments.map((path) => <span key={path}><Paperclip size={13} />{path.split(/[\\/]/).pop()}<button type="button" onClick={() => onRemoveAttachment(path)}><X size={12} /></button></span>)}</div>}
            <ComposerPrimitive.Input className="aui-composer-input" placeholder="向 Rux 发送消息" rows={2} />
            <div className="composer-controls">
              <div className="composer-left">
                {showAttachments && <button type="button" className="icon-button" aria-label="添加文件" onClick={onAddFiles}><Plus size={19} /></button>}
                {showWebSearch && <button type="button" className={`icon-button ${webSearch ? "is-active" : ""}`} aria-label={webSearch ? "关闭网页搜索" : "启用网页搜索"} title={webSearch ? "网页搜索已启用" : "启用网页搜索"} onClick={onToggleWebSearch}><Globe size={18} /></button>}
                {showPermission && <span className="scope-menu-wrap"><button type="button" className="scope-button" onClick={onToggleSandbox}><ShieldCheck size={16} />{permissionLabel}<CaretDown size={12} /></button>{sandboxOpen && permissionPopover}</span>}
              </div>
              <div className="composer-right">
                <AgentSelector agents={agents} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} runtimeProgress={runtimeProgress} />
                <AgentModeSelector agent={selectedDefinition} mode={agentMode} onMode={onAgentMode} />
                <button type="button" className={`composer-menu ${modelOpen === "models" ? "is-active" : ""}`} onClick={() => onToggleModel("models")}>{modelLabel}<CaretDown size={12} /></button>
                <button type="button" className={`composer-menu ${modelOpen === "reasoning" ? "is-active" : ""}`} onClick={() => onToggleModel("reasoning")}>{reasoningLabel}<CaretDown size={12} /></button>
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
    </AssistantRuntimeProvider>
  );
}
