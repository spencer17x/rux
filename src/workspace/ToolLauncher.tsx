import type { WorkspaceToolId } from "../renderer/types";
import { workspaceTools } from "./workspaceTools";

export default function ToolLauncher({ activeTool, hasProject, variant = "popover", onSelectTool }: { activeTool: WorkspaceToolId | ""; hasProject: boolean; variant?: "popover" | "panel"; onSelectTool: (tool: WorkspaceToolId) => void }) {
  return <aside className={`tool-launcher is-${variant}`} aria-label="工作区工具">{workspaceTools.map(({ id, label, Icon, shortcut, projectOnly }) => <button type="button" key={id} className={activeTool === id ? "is-active" : ""} aria-label={variant === "panel" ? label : undefined} aria-current={activeTool === id ? "true" : undefined} disabled={projectOnly && !hasProject} onClick={() => onSelectTool(id)}><Icon size={17} weight="regular" /><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>)}</aside>;
}
