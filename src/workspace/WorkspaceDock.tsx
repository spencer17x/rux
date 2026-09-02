import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, ArrowUp, CircleNotch, Eye, File, FolderOpen, Globe, Plus, Stop, X } from "@phosphor-icons/react";
import RuxTerminal, { type TerminalChunk } from "../terminal/RuxTerminal";
import type { WorkspaceToolId } from "../renderer/types";
import ToolLauncher from "./ToolLauncher";
import { workspaceTool } from "./workspaceTools";

type GitFile = { path: string; plus: number; minus: number };
type GitState = { branch: string; files: GitFile[] };
type Message = { id: string; role: "user" | "assistant"; text: string };
type SideApproval = { id: string; label: string };
type Props = {
  placement?: "bottom" | "right"; activeTool: WorkspaceToolId; hasProject: boolean; gitState: GitState; environmentContent?: ReactNode;
  terminalProps: { starting?: boolean; output: TerminalChunk[]; onInput: (data: string) => void; onResize: (size: { cols: number; rows: number }) => void };
  remoteUrl: string; projectFiles: string[]; sideMessages: Message[]; sideValue: string; sideSending: boolean; sideApproval: SideApproval | null; sideAgentLabel: string;
  onSelectTool: (tool: WorkspaceToolId) => void; onClose: () => void; onOpenReview: () => void; onOpenRemote: () => void;
  onOpenFile: (path: string) => void; onSideValue: (value: string) => void; onSendSide: () => void; onSideApproval: (decision: "accept" | "acceptForSession" | "decline") => void; onCancelSide: () => void;
};

export default function WorkspaceDock(props: Props) {
  const { placement = "bottom", activeTool, hasProject, gitState, terminalProps, remoteUrl, projectFiles, sideMessages, sideValue, sideSending, sideApproval, sideAgentLabel } = props;
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherScope = useRef<HTMLDivElement>(null);
  const selectedTool = workspaceTool(activeTool);
  const SelectedToolIcon = selectedTool.Icon;
  useEffect(() => {
    if (!launcherOpen) return undefined;
    const closeOnOutside = (event: PointerEvent) => { if (event.target instanceof Node && !launcherScope.current?.contains(event.target)) setLauncherOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setLauncherOpen(false); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [launcherOpen]);
  const selectTool = (tool: WorkspaceToolId) => { setLauncherOpen(false); props.onSelectTool(tool); };
  return <section className={`workspace-dock is-${placement} ${activeTool === "terminal" ? "is-terminal" : ""}`} aria-label={placement === "right" ? "右侧工作区面板" : "底部工作区面板"}>
    {placement === "right" ? <><header className="workspace-dock-header"><strong>工作区</strong><button type="button" className="icon-button" aria-label="关闭右侧面板" data-tooltip="关闭右侧面板" onClick={props.onClose}><X size={16} /></button></header><ToolLauncher variant="panel" activeTool={activeTool} hasProject={hasProject} onSelectTool={selectTool} /></> : <header className="workspace-dock-header"><div className="workspace-dock-active-tab"><SelectedToolIcon size={16} weight="regular" /><span>{selectedTool.label}</span><button type="button" aria-label={`关闭${selectedTool.label}`} onClick={props.onClose}><X size={14} /></button></div><div ref={launcherScope} className="workspace-tool-menu-wrap"><button type="button" className={`workspace-tool-menu-trigger ${launcherOpen ? "is-active" : ""}`} aria-label="切换工作区工具" aria-expanded={launcherOpen} onClick={() => setLauncherOpen((open) => !open)}><Plus size={17} /></button>{launcherOpen && <ToolLauncher activeTool={activeTool} hasProject={hasProject} onSelectTool={selectTool} />}</div><button type="button" className="icon-button workspace-dock-close" aria-label="关闭底部面板" data-tooltip="关闭底部面板" onClick={props.onClose}><X size={16} /></button></header>}
    <div className="workspace-dock-content">
      {activeTool === "environment" && <div className="dock-environment">{props.environmentContent}</div>}
      {activeTool === "review" && <div className="dock-review"><div><strong>{gitState.files.length} 个文件变更</strong><span>{gitState.branch || "—"}</span></div><div className="dock-file-chips">{gitState.files.slice(0, 8).map((file) => <span key={file.path}>{file.path}<small><b>+{file.plus}</b> <em>−{file.minus}</em></small></span>)}</div><button type="button" className="secondary-button" onClick={props.onOpenReview}><Eye size={15} />打开完整审查</button></div>}
      {activeTool === "terminal" && <RuxTerminal {...terminalProps} />}
      {activeTool === "browser" && <div className="dock-empty-tool"><Globe size={24} /><strong>{remoteUrl ? "项目远程仓库" : "未配置远程仓库"}</strong><span>{remoteUrl || "为当前项目添加 origin 后，可从这里打开。"}</span><button type="button" className="secondary-button" disabled={!remoteUrl} onClick={props.onOpenRemote}>在浏览器中打开</button></div>}
      {activeTool === "files" && <div className="dock-files">{projectFiles.length ? projectFiles.map((path) => <button type="button" key={path} onDoubleClick={() => props.onOpenFile(path)}><File size={14} /><span>{path}</span><ArrowSquareOut size={13} /></button>) : <div className="dock-empty-tool"><FolderOpen size={24} /><strong>项目中没有可显示的文件</strong></div>}</div>}
      {activeTool === "chat" && <div className="dock-side-chat"><div className="dock-chat-messages" aria-live="polite">{sideMessages.some((message) => message.text) ? sideMessages.filter((message) => message.text).map((message) => <p key={message.id} className={message.role === "user" ? "is-user" : "is-agent"}>{message.text}</p>) : <span>使用 {sideAgentLabel} 针对当前工作区快速提问，不影响主会话。</span>}{sideApproval && <div className="side-chat-approval" role="group" aria-label="侧边聊天操作批准"><strong>{sideApproval.label}需要批准</strong><span><button type="button" onClick={() => props.onSideApproval("decline")}>拒绝</button><button type="button" onClick={() => props.onSideApproval("accept")}>允许一次</button><button type="button" onClick={() => props.onSideApproval("acceptForSession")}>本次会话允许</button></span></div>}{sideSending && <p className="is-agent side-chat-loading" role="status"><CircleNotch size={14} className="spin" /><span>{sideAgentLabel} 正在回复</span><i aria-hidden="true"><b /><b /><b /></i></p>}</div><form onSubmit={(event) => { event.preventDefault(); if (!sideSending) props.onSendSide(); }}><input aria-label="侧边聊天消息" placeholder={sideSending ? `正在等待 ${sideAgentLabel} 回复…` : "输入工作区问题"} value={sideValue} onChange={(event) => props.onSideValue(event.target.value)} disabled={sideSending} />{sideSending ? <button type="button" aria-label="停止侧边聊天" onClick={props.onCancelSide}><Stop size={14} weight="fill" /></button> : <button type="submit" aria-label="发送侧边聊天消息" disabled={!sideValue.trim()}><ArrowUp size={15} /></button>}</form></div>}
    </div>
  </section>;
}
