import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CaretDown, ChatCircle, CircleNotch, DotsThree, Folder, FolderOpen, GearSix, MagnifyingGlass, Paperclip, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import IconButton from "../components/IconButton";
import type { ActiveThread, AuthState, ProjectRecord, ThreadRecord, WorkspaceState } from "../renderer/types";

type Props = {
  workspace: WorkspaceState; auth: AuthState; expandedProjects: string[]; activeThread: ActiveThread | null; runningThreadIds: ReadonlySet<string>;
  onToggleProject: (projectId: string) => void; onSelectProjectThread: (project: ProjectRecord, thread: ThreadRecord) => void;
  onSelectStandalone: (thread: ThreadRecord) => void; onAddProject: (trigger: HTMLButtonElement) => void; onRemoveProject: (project: ProjectRecord) => void;
  onOpenProjectPath: (project: ProjectRecord) => void; onCopyProjectPath: (project: ProjectRecord) => void;
  onNewProjectThread: (project: ProjectRecord) => void; onNewStandalone: () => void; onOpenSettings: () => void;
  onRenameThread: (thread: ActiveThread) => void;
  onDeleteThread: (thread: ActiveThread) => void;
};

function ThreadRow({ thread, active, child = false, running = false, onSelect, onRename, onDelete }: { thread: ThreadRecord; active: boolean; child?: boolean; running?: boolean; onSelect: () => void; onRename: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => { if (event.target instanceof Node && !scopeRef.current?.contains(event.target)) setMenuOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); } };
    document.addEventListener("pointerdown", onPointerDown); document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen]);
  return <div ref={scopeRef} className={`thread-row-wrap ${child ? "is-child" : ""} ${running ? "is-running" : ""}`} onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}>
    <button type="button" className={`sidebar-row ${child ? "child-row" : ""} ${active ? "is-selected" : ""}`} title="双击重命名会话" onClick={onSelect} onDoubleClick={(event) => { event.preventDefault(); onRename(); }}><ChatCircle size={16} /><span>{thread.title}</span></button>
    {running && <span className="thread-running-indicator" role="status" aria-label={`${thread.title} 正在响应`}><CircleNotch size={16} className="spin" /></span>}
    <IconButton ref={triggerRef} label={`会话操作 ${thread.title}`} className="thread-action-button" active={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}><DotsThree size={16} /></IconButton>
    {menuOpen && <div className="thread-action-popover" role="menu"><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}><PencilSimple size={15} />重命名会话</button><button type="button" role="menuitem" className="danger-text" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash size={15} />删除会话</button></div>}
  </div>;
}

export default function Sidebar(props: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [projectMenuPosition, setProjectMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const projectMenuTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!projectMenuId) return undefined;
    const close = (restoreFocus = false) => { const trigger = projectMenuTriggers.current[projectMenuId]; setProjectMenuId(null); setProjectMenuPosition(null); if (restoreFocus) requestAnimationFrame(() => trigger?.focus()); };
    const onPointerDown = (event: PointerEvent) => { const target = event.target; if (!(target instanceof Element) || !target.closest(`[data-project-menu-scope="${projectMenuId}"]`)) close(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [projectMenuId]);
  const query = searchQuery.trim().toLocaleLowerCase();
  const standaloneThreads = props.workspace.standaloneThreads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query));
  const projects = props.workspace.projects.map((project) => ({ ...project, threads: project.threads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query)) })).filter((project) => !query || project.name.toLocaleLowerCase().includes(query) || project.threads.length);
  const email = props.auth.account?.email || "";
  const accountName = email ? email.split("@")[0] : "Rux User";
  return <aside className="sidebar" aria-label="Rux 导航">
    <div className="sidebar-brand-row"><strong className="brand">Rux</strong><div className="sidebar-actions"><IconButton label="搜索" active={searchOpen} onClick={() => { setSearchOpen((open) => !open); setNotificationsOpen(false); setProfileOpen(false); }}><MagnifyingGlass size={18} /></IconButton><IconButton label="通知" active={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setSearchOpen(false); setProfileOpen(false); }}><Bell size={18} /></IconButton></div></div>
    {searchOpen && <label className="sidebar-search"><MagnifyingGlass size={16} /><input aria-label="搜索项目和会话" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><IconButton label="清除搜索" onClick={() => setSearchQuery("")}><X size={14} /></IconButton></label>}
    {notificationsOpen && <div className="sidebar-popover notification-popover"><strong>通知</strong><span>当前没有新通知</span></div>}
    <nav className="sidebar-scroll"><section className="sidebar-section"><div className="section-heading"><span>独立会话</span><IconButton label="新建独立会话" onClick={props.onNewStandalone}><Plus size={17} /></IconButton></div><div className="sidebar-list">{standaloneThreads.map((thread) => { const target: ActiveThread = { type: "standalone", ...thread }; return <ThreadRow key={thread.id} thread={thread} active={props.activeThread?.type === "standalone" && props.activeThread.id === thread.id} onSelect={() => props.onSelectStandalone(thread)} onRename={() => props.onRenameThread(target)} onDelete={() => props.onDeleteThread(target)} />; })}</div></section>
      <div className="section-divider" />
      <section className="sidebar-section project-section"><div className="section-heading"><span>项目</span><IconButton label="添加项目" onClick={(event) => props.onAddProject(event.currentTarget)}><Plus size={17} /></IconButton></div><div className="project-tree">{projects.map((project) => { const expanded = props.expandedProjects.includes(project.id); const activeProject = props.activeThread?.type === "project" && props.activeThread.projectId === project.id; return <div className={`project-node ${expanded ? "is-expanded" : ""} ${activeProject ? "has-active-thread" : ""} ${projectMenuId === project.id ? "is-menu-open" : ""}`} data-project-menu-scope={project.id} key={project.id}><div className="project-row-wrap"><button type="button" className="project-row" aria-expanded={expanded} onClick={() => { props.onToggleProject(project.id); setProjectMenuId(null); setProjectMenuPosition(null); }} onContextMenu={(event) => { event.preventDefault(); setProjectMenuId(project.id); setProjectMenuPosition({ top: event.clientY + 4, left: event.clientX - 8 }); }}>{expanded ? <FolderOpen size={18} /> : <Folder size={18} />}<span>{project.name}</span></button><div className="project-row-actions"><IconButton ref={(element) => { projectMenuTriggers.current[project.id] = element; }} label={`项目操作 ${project.name}`} className="project-action-button" active={projectMenuId === project.id} onClick={(event) => { event.stopPropagation(); if (projectMenuId === project.id) { setProjectMenuId(null); setProjectMenuPosition(null); } else { const rect = event.currentTarget.getBoundingClientRect(); setProjectMenuId(project.id); setProjectMenuPosition({ top: rect.bottom + 4, left: rect.left - 6 }); } }}><DotsThree size={17} /></IconButton><IconButton label={`新建项目会话 ${project.name}`} className="project-new-thread-button" onClick={(event) => { event.stopPropagation(); props.onNewProjectThread(project); }}><PencilSimple size={17} /></IconButton></div></div>
        {projectMenuId === project.id && projectMenuPosition && createPortal(<div className="project-action-popover" data-project-menu-scope={project.id} role="menu" style={projectMenuPosition}><button type="button" onClick={() => { setProjectMenuId(null); setProjectMenuPosition(null); props.onNewProjectThread(project); }}><PencilSimple size={17} />新建会话</button><div className="project-menu-separator" /><button type="button" onClick={() => { setProjectMenuId(null); setProjectMenuPosition(null); props.onOpenProjectPath(project); }}><FolderOpen size={17} />在文件管理器中打开</button><button type="button" onClick={() => { setProjectMenuId(null); setProjectMenuPosition(null); props.onCopyProjectPath(project); }}><Paperclip size={17} />复制项目路径</button><div className="project-menu-separator" /><button type="button" className="danger-text" onClick={() => { setProjectMenuId(null); setProjectMenuPosition(null); props.onRemoveProject(project); }}><Trash size={17} />移除项目</button></div>, document.body)}
        {expanded && <div className="thread-children">{project.threads.map((thread) => { const target: ActiveThread = { type: "project", projectId: project.id, projectName: project.name, projectPath: project.path, ...thread }; return <ThreadRow key={thread.id} thread={thread} child running={props.runningThreadIds.has(thread.id)} active={props.activeThread?.type === "project" && props.activeThread.id === thread.id} onSelect={() => props.onSelectProjectThread(project, thread)} onRename={() => props.onRenameThread(target)} onDelete={() => props.onDeleteThread(target)} />; })}</div>}
      </div>; })}</div></section></nav>
    {profileOpen && <div className="sidebar-popover profile-popover"><strong>{accountName}</strong><small>{email || (props.auth.connected ? "Codex 已连接" : "Codex 未登录")}</small><button type="button" onClick={props.onOpenSettings}><GearSix size={16} />设置</button></div>}
    <button type="button" className="profile-row" onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); setSearchOpen(false); }} aria-expanded={profileOpen}><span className="avatar avatar-small">{accountName.slice(0, 1).toUpperCase()}</span><span>{accountName}</span><CaretDown size={15} /></button>
  </aside>;
}
