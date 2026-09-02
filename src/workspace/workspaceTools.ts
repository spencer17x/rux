import {
  ChatCircle,
  FileText,
  FolderOpen,
  Globe,
  SlidersHorizontal,
  TerminalWindow,
  type Icon,
} from "@phosphor-icons/react";
import type { WorkspaceToolId } from "../renderer/types";

export type WorkspaceToolDefinition = {
  id: WorkspaceToolId;
  label: string;
  Icon: Icon;
  shortcut: string;
  projectOnly: boolean;
};

export const workspaceTools: WorkspaceToolDefinition[] = [
  { id: "environment", label: "环境", Icon: SlidersHorizontal, shortcut: "", projectOnly: false },
  { id: "review", label: "审查", Icon: FileText, shortcut: "⌃⇧G", projectOnly: true },
  { id: "terminal", label: "终端", Icon: TerminalWindow, shortcut: "⌃`", projectOnly: true },
  { id: "browser", label: "浏览器", Icon: Globe, shortcut: "⌘T", projectOnly: true },
  { id: "files", label: "文件", Icon: FolderOpen, shortcut: "⌘P", projectOnly: true },
  { id: "chat", label: "侧边聊天", Icon: ChatCircle, shortcut: "⌥⌘S", projectOnly: false },
];

export function workspaceTool(id: WorkspaceToolId): WorkspaceToolDefinition {
  return workspaceTools.find((tool) => tool.id === id) ?? workspaceTools[0];
}
