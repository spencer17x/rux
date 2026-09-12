import { Button, Input, IconButton, Menu, MenuItem } from "../ui";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOut, ArrowUp, CircleNotch, Eye, File, FolderOpen, Globe, Plus, Stop, X } from "../ui/icons";
import type { TerminalChunk } from "../terminal/RuxTerminal";
const RuxTerminal = lazy(() => import("../terminal/RuxTerminal"));
import type { WorkspaceToolId } from "../renderer/types";
import ToolLauncher from "./ToolLauncher";
import { workspaceTool, workspaceTools } from "./workspaceTools";

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
  const selectedTool = workspaceTool(activeTool);
  const SelectedToolIcon = selectedTool.Icon;
  const selectTool = (tool: WorkspaceToolId) => { setLauncherOpen(false); props.onSelectTool(tool); };
  return <section className={`workspace-dock is-${placement} ${activeTool === "terminal" ? "is-terminal" : ""}`} aria-label={placement === "right" ? "右侧工作区面板" : "底部工作区面板"}>
    {placement === "right" ? <><header className="workspace-dock-header"><strong>工作区</strong><IconButton label="关闭右侧面板" icon="close" onClick={props.onClose} /></header><ToolLauncher variant="panel" activeTool={activeTool} hasProject={hasProject} onSelectTool={selectTool} /></> : <header className="workspace-dock-header"><div className="workspace-dock-active-tab"><SelectedToolIcon size="sm" /><span>{selectedTool.label}</span><Button variant="plain" type="button" aria-label={`关闭${selectedTool.label}`} onClick={props.onClose}><X size="sm" /></Button></div><Menu label="工作区工具" open={launcherOpen} onOpenChange={setLauncherOpen} side="top" align="start" trigger={<IconButton label="切换工作区工具" icon="add" active={launcherOpen} />}>{workspaceTools.map(({ id, label, Icon, shortcut, projectOnly }) => <MenuItem key={id} disabled={projectOnly && !hasProject} onSelect={() => selectTool(id)}><Icon /><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</MenuItem>)}</Menu><IconButton label="关闭底部面板" icon="close" className="workspace-dock-close" onClick={props.onClose} /></header>}
    <div className="workspace-dock-content">
      {activeTool === "environment" && <div className="dock-environment">{props.environmentContent}</div>}
      {activeTool === "review" && <div className="dock-review"><div><strong>{gitState.files.length} 个文件变更</strong><span>{gitState.branch || "—"}</span></div><div className="dock-file-chips">{gitState.files.slice(0, 8).map((file) => <span key={file.path}>{file.path}<small><b>+{file.plus}</b> <em>−{file.minus}</em></small></span>)}</div><Button variant="secondary" type="button" className="secondary-button" onClick={props.onOpenReview}><Eye size="sm" />打开完整审查</Button></div>}
      {activeTool === "terminal" && <Suspense fallback={<div className="runtime-inline-progress" role="status">正在加载终端…</div>}><RuxTerminal {...terminalProps} /></Suspense>}
      {activeTool === "browser" && <div className="dock-empty-tool"><Globe size="lg" /><strong>{remoteUrl ? "项目远程仓库" : "未配置远程仓库"}</strong><span>{remoteUrl || "为当前项目添加 origin 后，可从这里打开。"}</span><Button variant="secondary" type="button" className="secondary-button" disabled={!remoteUrl} onClick={props.onOpenRemote}>在浏览器中打开</Button></div>}
      {activeTool === "files" && <div className="dock-files">{projectFiles.length ? projectFiles.map((path) => <Button variant="plain" type="button" key={path} onClick={() => props.onOpenFile(path)} title={`打开 ${path}`}><File size="sm" /><span>{path}</span><ArrowSquareOut size="xs" /></Button>) : <div className="dock-empty-tool"><FolderOpen size="lg" /><strong>项目中没有可显示的文件</strong></div>}</div>}
      {activeTool === "chat" && <div className="dock-side-chat"><div className="dock-chat-messages" aria-live="polite">{sideMessages.some((message) => message.text) ? sideMessages.filter((message) => message.text).map((message) => <p key={message.id} className={message.role === "user" ? "is-user" : "is-agent"}>{message.text}</p>) : <span>使用 {sideAgentLabel} 针对当前工作区快速提问，不影响主会话。</span>}{sideApproval && <div className="side-chat-approval" role="group" aria-label="侧边聊天操作批准"><strong>{sideApproval.label}需要批准</strong><span><Button variant="plain" type="button" onClick={() => props.onSideApproval("decline")}>拒绝</Button><Button variant="plain" type="button" onClick={() => props.onSideApproval("accept")}>允许一次</Button><Button variant="plain" type="button" onClick={() => props.onSideApproval("acceptForSession")}>本次会话允许</Button></span></div>}{sideSending && <p className="is-agent side-chat-loading" role="status"><CircleNotch size="sm" className="spin" /><span>{sideAgentLabel} 正在回复</span><i aria-hidden="true"><b /><b /><b /></i></p>}</div><form onSubmit={(event) => { event.preventDefault(); if (!sideSending) props.onSendSide(); }}><Input aria-label="侧边聊天消息" placeholder={sideSending ? `正在等待 ${sideAgentLabel} 回复…` : "输入工作区问题"} value={sideValue} onChange={(event) => props.onSideValue(event.target.value)} disabled={sideSending} />{sideSending ? <Button variant="plain" type="button" aria-label="停止侧边聊天" onClick={props.onCancelSide}><Stop size="sm" variant="solid" /></Button> : <Button variant="plain" type="submit" aria-label="发送侧边聊天消息" disabled={!sideValue.trim()}><ArrowUp size="sm" /></Button>}</form></div>}
    </div>
  </section>;
}
