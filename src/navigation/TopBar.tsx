import { useEffect, useRef, useState } from "react";
import { ChatCircle, Copy, DotsThree, Folder, GearSix, SidebarSimple } from "@phosphor-icons/react";
import IconButton from "../components/IconButton";
import type { ActiveThread } from "../renderer/types";

type Props = { activeThread: ActiveThread | null; leftPanelOpen: boolean; bottomPanelOpen: boolean; rightPanelOpen: boolean; onToggleLeftPanel: () => void; onToggleBottomPanel: () => void; onToggleRightPanel: () => void; onOpenSettings: () => void; onOpenPath: () => void; onCopyPath: () => void; onShare: () => void; onRename: () => void; onRemoveThread: () => void };

export default function TopBar(props: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMoreOpen(false); }, [props.activeThread?.id]);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMoreOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [moreOpen]);
  const isProject = props.activeThread?.type === "project";
  return <header className="topbar"><div className="topbar-title">{isProject ? <Folder size={19} /> : <ChatCircle size={19} />}{isProject && <span className="muted-title">{props.activeThread?.projectName}</span>}{isProject && <span className="title-separator">/</span>}<strong>{props.activeThread?.title || "Rux"}</strong>{!isProject && <span className="standalone-badge">独立会话</span>}<span ref={menuRef} className="toolbar-menu-wrap"><IconButton ref={triggerRef} aria-haspopup="menu" aria-expanded={moreOpen} label="更多" active={moreOpen} onClick={() => setMoreOpen((open) => !open)}><DotsThree size={20} /></IconButton>{moreOpen && <span className="toolbar-popover" role="menu" aria-label="会话操作">{isProject && <><button type="button" onClick={() => { setMoreOpen(false); props.onOpenPath(); }}>在文件管理器中打开</button><button type="button" onClick={() => { setMoreOpen(false); props.onCopyPath(); }}>复制项目路径</button><span className="toolbar-menu-separator" /></>}<button type="button" onClick={() => { setMoreOpen(false); props.onRename(); }}>重命名会话</button><button type="button" className="danger-text" onClick={() => { setMoreOpen(false); props.onRemoveThread(); }}>删除会话</button></span>}</span></div>
    <div className="topbar-actions"><button type="button" className="topbar-share-button" aria-label="复制会话内容" title="复制会话内容" onClick={props.onShare}><Copy size={17} />复制会话</button><span className="panel-toggle-group" role="group" aria-label="工作区面板"><IconButton label="切换左侧面板" className="panel-toggle-button" active={props.leftPanelOpen} aria-pressed={props.leftPanelOpen} onClick={props.onToggleLeftPanel}><SidebarSimple className="panel-layout-icon panel-layout-left" size={20} /></IconButton><IconButton label="切换底部面板" className="panel-toggle-button" active={props.bottomPanelOpen} aria-pressed={props.bottomPanelOpen} onClick={props.onToggleBottomPanel}><SidebarSimple className="panel-layout-icon panel-layout-bottom" size={20} /></IconButton><IconButton label="切换右侧面板" className="panel-toggle-button" active={props.rightPanelOpen} aria-pressed={props.rightPanelOpen} onClick={props.onToggleRightPanel}><SidebarSimple className="panel-layout-icon panel-layout-right" size={20} /></IconButton></span><IconButton label="设置" onClick={props.onOpenSettings}><GearSix size={18} /></IconButton></div>
  </header>;
}
