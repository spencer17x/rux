import { useState } from "react";
import { CaretDown, ChatCircle, DotsThree, Folder, GearSix, ShareNetwork } from "@phosphor-icons/react";
import IconButton from "../components/IconButton";
import type { ActiveThread } from "../renderer/types";

type Props = { activeThread: ActiveThread | null; bottomPanelOpen: boolean; rightPanelOpen: boolean; onToggleBottomPanel: () => void; onToggleRightPanel: () => void; onOpenSettings: () => void; onOpenPath: () => void; onCopyPath: () => void; onShare: () => void; onRename: () => void; onRemoveThread: () => void };

function PanelBottomIcon() {
  return <svg data-panel-icon="bottom" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.25" stroke="currentColor" strokeWidth="1.6" /><path d="M3.5 12.75H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function PanelRightIcon() {
  return <svg data-panel-icon="right" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.25" stroke="currentColor" strokeWidth="1.6" /><path d="M12.75 4V16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export default function TopBar(props: Props) {
  const [moreOpen, setMoreOpen] = useState(false); const [pathOpen, setPathOpen] = useState(false);
  const isProject = props.activeThread?.type === "project";
  return <header className="topbar"><div className="topbar-title">{isProject ? <Folder size={19} /> : <ChatCircle size={19} />}{isProject && <span className="muted-title">{props.activeThread?.projectName}</span>}{isProject && <span className="title-separator">/</span>}<strong>{props.activeThread?.title || "Rux"}</strong>{!isProject && <span className="standalone-badge">独立会话</span>}<span className="toolbar-menu-wrap"><IconButton label="更多" active={moreOpen} onClick={() => { setMoreOpen((open) => !open); setPathOpen(false); }}><DotsThree size={20} /></IconButton>{moreOpen && <span className="toolbar-popover"><button type="button" onClick={() => { setMoreOpen(false); props.onRename(); }}>重命名会话</button><button type="button" className="danger-text" onClick={() => { setMoreOpen(false); props.onRemoveThread(); }}>移除会话</button></span>}</span></div>
    <div className="topbar-actions"><IconButton label="复制会话内容" onClick={props.onShare}><ShareNetwork size={18} /></IconButton>{isProject && <span className="toolbar-menu-wrap"><button type="button" className="toolbar-button" aria-expanded={pathOpen} onClick={() => { setPathOpen((open) => !open); setMoreOpen(false); }}>打开位置<CaretDown size={14} /></button>{pathOpen && <span className="toolbar-popover path-popover"><button type="button" onClick={() => { setPathOpen(false); props.onOpenPath(); }}>在文件管理器中打开</button><button type="button" onClick={() => { setPathOpen(false); props.onCopyPath(); }}>复制项目路径</button></span>}</span>}<IconButton label="切换底部面板" className="panel-toggle-button" active={props.bottomPanelOpen} onClick={props.onToggleBottomPanel}><PanelBottomIcon /></IconButton><IconButton label="切换右侧面板" className="panel-toggle-button" active={props.rightPanelOpen} onClick={props.onToggleRightPanel}><PanelRightIcon /></IconButton><IconButton label="设置" onClick={props.onOpenSettings}><GearSix size={18} /></IconButton></div>
  </header>;
}
