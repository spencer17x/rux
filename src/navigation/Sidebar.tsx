import { useDeferredValue, useEffect, useState } from "react";
import { Button, Input, NavItem, IconButton, Menu, MenuItem, MenuSeparator, ContextActions, ContextAction, Popover } from "../ui";
import { CaretDown, ChatCircle, CircleNotch, Folder, FolderOpen, GearSix, MagnifyingGlass, Paperclip, PencilSimple, Plus, Trash } from "../ui/icons";
import SidebarResizeHandle, { readSidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_WIDTH_KEY } from "./SidebarResizeHandle";
import type { ActiveThread, AuthState, ProjectRecord, ThreadRecord, WorkspaceState } from "../renderer/types";
import ruxMark from "../assets/rux-mark.png";

type Props = {
  reservedPanelWidth?: number;
  workspace: WorkspaceState; auth: AuthState; expandedProjects: string[]; activeThread: ActiveThread | null; runningThreadIds: ReadonlySet<string>;
  onToggleProject: (projectId: string) => void; onSelectProjectThread: (project: ProjectRecord, thread: ThreadRecord) => void;
  onSelectStandalone: (thread: ThreadRecord) => void; onAddProject: (trigger: HTMLButtonElement) => void; onRemoveProject: (project: ProjectRecord) => void;
  onOpenProjectPath: (project: ProjectRecord) => void; onCopyProjectPath: (project: ProjectRecord) => void;
  onNewProjectThread: (project: ProjectRecord) => void; onNewStandalone: () => void; onOpenSettings: () => void;
  onRenameThread: (thread: ActiveThread) => void;
  onDeleteThread: (thread: ActiveThread) => void;
};

function ThreadActions({ onRename, onDelete, context = false }: { onRename: () => void; onDelete: () => void; context?: boolean }) {
  const Item = context ? ContextAction : MenuItem;
  return <><Item onSelect={onRename}><PencilSimple />重命名会话</Item><Item danger onSelect={onDelete}><Trash />删除会话</Item></>;
}

function ThreadRow({ thread, active, child = false, running = false, onSelect, onRename, onDelete }: { thread: ThreadRecord; active: boolean; child?: boolean; running?: boolean; onSelect: () => void; onRename: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const row = <div className={`thread-row-wrap ${child ? "is-child" : ""} ${running ? "is-running" : ""}`}>
    <NavItem size="lg" active={active} className={`sidebar-row ${child ? "child-row" : ""} ${active ? "is-selected" : ""}`} title="双击重命名会话" onClick={onSelect} onDoubleClick={(event) => { event.preventDefault(); onRename(); }}><ChatCircle /><span>{thread.title}</span></NavItem>
    {running && <span className="thread-running-indicator" role="status" aria-label={`${thread.title} 正在响应`}><CircleNotch className="ui-spin" /></span>}
    <Menu label={`会话操作 ${thread.title}`} open={menuOpen} onOpenChange={setMenuOpen} trigger={<IconButton label={`会话操作 ${thread.title}`} icon="more" className="thread-action-button" active={menuOpen} />}><ThreadActions onRename={onRename} onDelete={onDelete} /></Menu>
  </div>;
  return <ContextActions label={`会话操作 ${thread.title}`} trigger={row}><ThreadActions context onRename={onRename} onDelete={onDelete} /></ContextActions>;
}

function ProjectActions({ project, actions, context = false }: { project: ProjectRecord; actions: Props; context?: boolean }) {
  const Item = context ? ContextAction : MenuItem;
  return <>
    <Item onSelect={() => actions.onNewProjectThread(project)}><PencilSimple />新建会话</Item>
    {!context && <MenuSeparator />}
    <Item onSelect={() => actions.onOpenProjectPath(project)}><FolderOpen />在文件管理器中打开</Item>
    <Item onSelect={() => actions.onCopyProjectPath(project)}><Paperclip />复制项目路径</Item>
    {!context && <MenuSeparator />}
    <Item danger onSelect={() => actions.onRemoveProject(project)}><Trash />移除项目</Item>
  </>;
}

function ProjectNode({ project, actions, query }: { project: ProjectRecord; actions: Props; query: string }) {
  const [open, setOpen] = useState(false);
  const expanded = Boolean(query) || actions.expandedProjects.includes(project.id);
  const active = actions.activeThread?.type === "project" && actions.activeThread.projectId === project.id;
  return <div className={`project-node ${expanded ? "is-expanded" : ""} ${active ? "has-active-thread" : ""} ${open ? "is-menu-open" : ""}`}>
    <ContextActions label={`项目操作 ${project.name}`} trigger={<div className="project-row-wrap">
      <NavItem size="lg" className="project-row" aria-expanded={expanded} onClick={() => actions.onToggleProject(project.id)}>{expanded ? <FolderOpen /> : <Folder />}<span>{project.name}</span></NavItem>
      <div className="project-row-actions"><Menu label={`项目操作 ${project.name}`} open={open} onOpenChange={setOpen} align="start" trigger={<IconButton label={`项目操作 ${project.name}`} icon="more" className="project-action-button" active={open} />}><ProjectActions project={project} actions={actions} /></Menu><IconButton label={`新建项目会话 ${project.name}`} icon="edit" className="project-new-thread-button" onClick={() => actions.onNewProjectThread(project)} /></div>
    </div>}><ProjectActions context project={project} actions={actions} /></ContextActions>
    {expanded && <div className="thread-children">{project.threads.map((thread) => {
      const target: ActiveThread = { type: "project", projectId: project.id, projectName: project.name, projectPath: project.path, ...thread };
      return <ThreadRow key={thread.id} child thread={thread} running={actions.runningThreadIds.has(thread.id)} active={actions.activeThread?.type === "project" && actions.activeThread.id === thread.id} onSelect={() => actions.onSelectProjectThread(project, thread)} onRename={() => actions.onRenameThread(target)} onDelete={() => actions.onDeleteThread(target)} />;
    })}</div>}
  </div>;
}

export default function Sidebar(props: Props) {
  const [preferredWidth, setPreferredWidth] = useState(readSidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => { const update = () => setViewportWidth(window.innerWidth); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); }, []);
  const maximumWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - 320 - (props.reservedPanelWidth || 0)));
  const sidebarWidth = Math.min(preferredWidth, maximumWidth);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const query = useDeferredValue(searchQuery.trim().toLocaleLowerCase());
  const standaloneThreads = props.workspace.standaloneThreads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query));
  const projects = props.workspace.projects.flatMap((project) => {
    if (!query || project.name.toLocaleLowerCase().includes(query)) return [project];
    const threads = project.threads.filter((thread) => thread.title.toLocaleLowerCase().includes(query));
    return threads.length ? [{ ...project, threads }] : [];
  });
  const email = props.auth.account?.email || "";
  const accountName = email ? email.split("@")[0] : "Rux User";
  return <aside className="sidebar" aria-label="Rux 导航" style={{ flexBasis: sidebarWidth, width: sidebarWidth }}>
    <div className="sidebar-brand-row"><strong className="brand"><img src={ruxMark} alt="" />Rux</strong><div className="sidebar-actions"><IconButton label="搜索" icon="search" active={searchOpen} onClick={() => { setSearchOpen((open) => !open); setProfileOpen(false); }} /></div></div>
    {searchOpen && <label className="sidebar-search"><MagnifyingGlass /><Input size="sm" aria-label="搜索项目和会话" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><IconButton label="清除搜索" icon="close" onClick={() => setSearchQuery("")} /></label>}
    <Button variant="secondary" size="lg" className="sidebar-new-chat" aria-label="新建独立会话" onClick={props.onNewStandalone}><Plus size="md" /><span>新建会话</span><kbd>⌘ N</kbd></Button>
    <nav className="sidebar-scroll">
      {query && !standaloneThreads.length && !projects.length && <p className="sidebar-empty" role="status">未找到匹配的项目或会话</p>}
      <section className="sidebar-section project-section"><div className="section-heading"><span>项目</span><IconButton label="添加项目" icon="add" onClick={(event) => props.onAddProject(event.currentTarget)} /></div><div className="project-tree">{projects.map((project) => <ProjectNode key={project.id} project={project} actions={props} query={query} />)}</div></section>
      {standaloneThreads.length > 0 && <><div className="section-divider" /><section className="sidebar-section"><div className="section-heading"><span>独立会话</span></div><div className="sidebar-list">{standaloneThreads.map((thread) => {
        const target: ActiveThread = { type: "standalone", ...thread };
        return <ThreadRow key={thread.id} thread={thread} running={props.runningThreadIds.has(thread.id)} active={props.activeThread?.type === "standalone" && props.activeThread.id === thread.id} onSelect={() => props.onSelectStandalone(thread)} onRename={() => props.onRenameThread(target)} onDelete={() => props.onDeleteThread(target)} />;
      })}</div></section></>}
    </nav>
    <Popover label="账户" open={profileOpen} onOpenChange={(open) => { setProfileOpen(open); if (open) setSearchOpen(false); }} align="start" className="profile-popover" trigger={<Button variant="plain" className="profile-row"><span className="avatar avatar-small">{accountName.slice(0, 1).toUpperCase()}</span><span>{accountName}</span><CaretDown size="xs" /></Button>}><strong>{accountName}</strong><small>{email || (props.auth.connected ? "Codex 已连接" : "Codex 未登录")}</small><Button variant="ghost" onClick={() => { setProfileOpen(false); props.onOpenSettings(); }}><GearSix />设置</Button></Popover>
    <Button variant="plain" className="sidebar-settings" aria-label="打开设置" onClick={props.onOpenSettings}><GearSix />设置</Button>
    <SidebarResizeHandle width={sidebarWidth} maximum={maximumWidth} onChange={setPreferredWidth} onCommit={(width) => { try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)); } catch { /* Applies to this window even if storage is unavailable. */ } }} />
  </aside>;
}
