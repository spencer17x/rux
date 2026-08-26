import { ChatCircle, FileText, FolderOpen, Globe, TerminalWindow } from "@phosphor-icons/react";
import type { WorkspaceToolId } from "../renderer/types";

const tools = [{ id: "review" as const, label: "审查", Icon: FileText, shortcut: "⌃⇧G", projectOnly: true }, { id: "terminal" as const, label: "终端", Icon: TerminalWindow, shortcut: "⌃`", projectOnly: true }, { id: "browser" as const, label: "浏览器", Icon: Globe, shortcut: "⌘T", projectOnly: true }, { id: "files" as const, label: "文件", Icon: FolderOpen, shortcut: "⌘P", projectOnly: true }, { id: "chat" as const, label: "侧边聊天", Icon: ChatCircle, shortcut: "⌥⌘S", projectOnly: false }];

export default function ToolLauncher({ activeTool, hasProject, onSelectTool }: { activeTool: WorkspaceToolId | ""; hasProject: boolean; onSelectTool: (tool: WorkspaceToolId) => void }) {
  return <aside className="tool-launcher" aria-label="工作区工具">{tools.map(({ id, label, Icon, shortcut, projectOnly }) => <button type="button" key={id} className={activeTool === id ? "is-active" : ""} disabled={projectOnly && !hasProject} onClick={() => onSelectTool(id)}><Icon size={18} /><span>{label}</span><kbd>{shortcut}</kbd></button>)}</aside>;
}
