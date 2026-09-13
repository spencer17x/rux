import { useEffect, useState } from "react";
import { CaretDown, ChatCircle, Folder, GitBranch, SidebarSimple } from "../ui/icons";
import { Button, IconButton, Menu, MenuItem, MenuSeparator, MenuRadioGroup, MenuRadioItem } from "../ui";
import type { ActiveThread } from "../renderer/types";

type Props = { activeThread: ActiveThread | null; leftPanelOpen: boolean; bottomPanelOpen: boolean; rightPanelOpen: boolean; onToggleLeftPanel: () => void; onToggleBottomPanel: () => void; onToggleRightPanel: () => void; onOpenSettings: () => void; onOpenPath: () => void; onCopyPath: () => void; onShare: () => void; onRename: () => void; onRemoveThread: () => void; branch?: string; branches?: string[]; gitBusy?: boolean; onSwitchBranch?: (branch: string) => void; onReview?: () => void; onTerminal?: () => void };

export default function TopBar(props: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [props.activeThread?.id]);
  const isProject = props.activeThread?.type === "project";
  return <header className="topbar"><div className="topbar-title">
    {isProject ? <Folder size="md" /> : <ChatCircle size="md" />}
    {isProject && <><span className="muted-title">{props.activeThread?.projectName}</span><span className="title-separator">/</span></>}
    <strong>{props.activeThread?.title || "Rux"}</strong>{!isProject && <span className="standalone-badge">独立会话</span>}
    <Menu label="会话操作" open={moreOpen} onOpenChange={setMoreOpen} trigger={<IconButton label="更多" icon="more" active={moreOpen} />}>
      {isProject && <><MenuItem onSelect={props.onOpenPath}>在文件管理器中打开</MenuItem><MenuItem onSelect={props.onCopyPath}>复制项目路径</MenuItem><MenuSeparator /></>}
      <MenuItem onSelect={props.onShare}>复制会话内容</MenuItem><MenuItem onSelect={props.onRename}>重命名会话</MenuItem><MenuItem danger onSelect={props.onRemoveThread}>删除会话</MenuItem>
    </Menu>
    {isProject && props.branch && <Menu label="Git 分支" trigger={<Button variant="plain" className="topbar-branch" aria-label="切换 Git 分支" title="当前 Git 分支" disabled={props.gitBusy || !props.branches?.length || !props.onSwitchBranch}><GitBranch size="sm" /><span>{props.branch}</span><CaretDown size="sm" /></Button>}><MenuRadioGroup value={props.branch} onValueChange={props.onSwitchBranch}>{props.branches?.map(branch => <MenuRadioItem key={branch} value={branch}>{branch}</MenuRadioItem>)}</MenuRadioGroup></Menu>}
  </div><div className="topbar-actions">
    <IconButton label="审查项目更改" icon="code" size="sm" iconSize="md" disabled={!isProject || !props.onReview} onClick={props.onReview} />
    <IconButton label="打开项目终端" icon="terminal" size="sm" iconSize="md" disabled={!isProject || !props.onTerminal} onClick={props.onTerminal} />
    <span className="panel-toggle-group" role="group" aria-label="工作区面板">
      <IconButton label="切换左侧面板" className="panel-toggle-button" size="sm" active={props.leftPanelOpen} aria-pressed={props.leftPanelOpen} onClick={props.onToggleLeftPanel}><SidebarSimple className="panel-layout-icon panel-layout-left" size="md" /></IconButton>
      <IconButton label="切换底部面板" className="panel-toggle-button" size="sm" active={props.bottomPanelOpen} aria-pressed={props.bottomPanelOpen} onClick={props.onToggleBottomPanel}><SidebarSimple className="panel-layout-icon panel-layout-bottom" size="md" /></IconButton>
      <IconButton label="切换右侧面板" className="panel-toggle-button" size="sm" active={props.rightPanelOpen} aria-pressed={props.rightPanelOpen} onClick={props.onToggleRightPanel}><SidebarSimple className="panel-layout-icon panel-layout-right" size="md" /></IconButton>
    </span><IconButton label="设置" icon="settings" size="sm" iconSize="md" onClick={props.onOpenSettings} />
  </div></header>;
}
