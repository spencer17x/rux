import { ArrowSquareOut, ArrowUp, ChatCircle, CircleNotch, Eye, File, FileText, FolderOpen, Globe, Stop, TerminalWindow, X } from "@phosphor-icons/react";
import RuxTerminal, { type TerminalChunk } from "../terminal/RuxTerminal";

type GitFile = { path: string; plus: number; minus: number };
type GitState = { branch: string; files: GitFile[] };
type Message = { id: string; role: "user" | "assistant"; text: string };
type SideApproval = { id: string; label: string };
type ToolId = "review" | "terminal" | "browser" | "files" | "chat";
type Props = {
  activeTool: ToolId; hasProject: boolean; gitState: GitState;
  terminalProps: { starting?: boolean; output: TerminalChunk[]; onInput: (data: string) => void; onResize: (size: { cols: number; rows: number }) => void };
  remoteUrl: string; projectFiles: string[]; sideMessages: Message[]; sideValue: string; sideSending: boolean; sideApproval: SideApproval | null; sideAgentLabel: string;
  onSelectTool: (tool: ToolId) => void; onClose: () => void; onOpenReview: () => void; onOpenRemote: () => void;
  onOpenFile: (path: string) => void; onSideValue: (value: string) => void; onSendSide: () => void; onSideApproval: (decision: "accept" | "acceptForSession" | "decline") => void; onCancelSide: () => void;
};

const tools = [
  { id: "review" as const, label: "审查", Icon: FileText, projectOnly: true },
  { id: "terminal" as const, label: "终端", Icon: TerminalWindow, projectOnly: true },
  { id: "browser" as const, label: "浏览器", Icon: Globe, projectOnly: true },
  { id: "files" as const, label: "文件", Icon: FolderOpen, projectOnly: true },
  { id: "chat" as const, label: "侧边聊天", Icon: ChatCircle, projectOnly: false },
];

export default function WorkspaceDock(props: Props) {
  const { activeTool, hasProject, gitState, terminalProps, remoteUrl, projectFiles, sideMessages, sideValue, sideSending, sideApproval, sideAgentLabel } = props;
  return <section className={`workspace-dock ${activeTool === "terminal" ? "is-terminal" : ""}`} aria-label="底部工作区面板">
    <header className="workspace-dock-header"><div className="workspace-dock-tabs" role="tablist" aria-label="工作区工具">{tools.map(({ id, label, Icon, projectOnly }) => <button type="button" role="tab" aria-selected={activeTool === id} key={id} className={activeTool === id ? "is-active" : ""} disabled={projectOnly && !hasProject} onClick={() => props.onSelectTool(id)}><Icon size={15} />{label}</button>)}</div><button type="button" className="icon-button" aria-label="关闭底部面板" onClick={props.onClose}><X size={16} /></button></header>
    <div className="workspace-dock-content">
      {activeTool === "review" && <div className="dock-review"><div><strong>{gitState.files.length} 个文件变更</strong><span>{gitState.branch || "—"}</span></div><div className="dock-file-chips">{gitState.files.slice(0, 8).map((file) => <span key={file.path}>{file.path}<small><b>+{file.plus}</b> <em>−{file.minus}</em></small></span>)}</div><button type="button" className="secondary-button" onClick={props.onOpenReview}><Eye size={15} />打开完整审查</button></div>}
      {activeTool === "terminal" && <RuxTerminal {...terminalProps} />}
      {activeTool === "browser" && <div className="dock-empty-tool"><Globe size={24} /><strong>{remoteUrl ? "项目远程仓库" : "未配置远程仓库"}</strong><span>{remoteUrl || "为当前项目添加 origin 后，可从这里打开。"}</span><button type="button" className="secondary-button" disabled={!remoteUrl} onClick={props.onOpenRemote}>在浏览器中打开</button></div>}
      {activeTool === "files" && <div className="dock-files">{projectFiles.length ? projectFiles.map((path) => <button type="button" key={path} onDoubleClick={() => props.onOpenFile(path)}><File size={14} /><span>{path}</span><ArrowSquareOut size={13} /></button>) : <div className="dock-empty-tool"><FolderOpen size={24} /><strong>项目中没有可显示的文件</strong></div>}</div>}
      {activeTool === "chat" && <div className="dock-side-chat"><div className="dock-chat-messages" aria-live="polite">{sideMessages.some((message) => message.text) ? sideMessages.filter((message) => message.text).map((message) => <p key={message.id} className={message.role === "user" ? "is-user" : "is-agent"}>{message.text}</p>) : <span>使用 {sideAgentLabel} 针对当前工作区快速提问，不影响主会话。</span>}{sideApproval && <div className="side-chat-approval" role="group" aria-label="侧边聊天操作批准"><strong>{sideApproval.label}需要批准</strong><span><button type="button" onClick={() => props.onSideApproval("decline")}>拒绝</button><button type="button" onClick={() => props.onSideApproval("accept")}>允许一次</button><button type="button" onClick={() => props.onSideApproval("acceptForSession")}>本次会话允许</button></span></div>}{sideSending && <p className="is-agent side-chat-loading" role="status"><CircleNotch size={14} className="spin" /><span>{sideAgentLabel} 正在回复</span><i aria-hidden="true"><b /><b /><b /></i></p>}</div><form onSubmit={(event) => { event.preventDefault(); if (!sideSending) props.onSendSide(); }}><input aria-label="侧边聊天消息" placeholder={sideSending ? `正在等待 ${sideAgentLabel} 回复…` : "输入工作区问题"} value={sideValue} onChange={(event) => props.onSideValue(event.target.value)} disabled={sideSending} />{sideSending ? <button type="button" aria-label="停止侧边聊天" onClick={props.onCancelSide}><Stop size={14} weight="fill" /></button> : <button type="submit" aria-label="发送侧边聊天消息" disabled={!sideValue.trim()}><ArrowUp size={15} /></button>}</form></div>}
    </div>
  </section>;
}
