import { useState } from "react";
import { Bell, CaretDown, CaretRight, ChatCircle, DotsThree, Folder, FolderOpen, GearSix, MagnifyingGlass, Paperclip, Plus, Trash, X } from "@phosphor-icons/react";
import IconButton from "../components/IconButton";
import type { ActiveThread, AuthState, ProjectRecord, ThreadRecord, WorkspaceState } from "../renderer/types";

type Props = {
  workspace: WorkspaceState; auth: AuthState; expandedProjects: string[]; activeThread: ActiveThread | null;
  onToggleProject: (projectId: string) => void; onSelectProjectThread: (project: ProjectRecord, thread: ThreadRecord) => void;
  onSelectStandalone: (thread: ThreadRecord) => void; onAddProject: (trigger: HTMLButtonElement) => void; onRemoveProject: (project: ProjectRecord) => void;
  onOpenProjectPath: (project: ProjectRecord) => void; onCopyProjectPath: (project: ProjectRecord) => void;
  onNewProjectThread: (project: ProjectRecord) => void; onNewStandalone: () => void; onOpenSettings: () => void;
};

export default function Sidebar(props: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const query = searchQuery.trim().toLocaleLowerCase();
  const standaloneThreads = props.workspace.standaloneThreads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query));
  const projects = props.workspace.projects.map((project) => ({ ...project, threads: project.threads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query)) })).filter((project) => !query || project.name.toLocaleLowerCase().includes(query) || project.threads.length);
  const email = props.auth.account?.email || "";
  const accountName = email ? email.split("@")[0] : "Rux User";
  return <aside className="sidebar" aria-label="Rux 导航">
    <div className="sidebar-brand-row"><strong className="brand">Rux</strong><div className="sidebar-actions"><IconButton label="搜索" active={searchOpen} onClick={() => { setSearchOpen((open) => !open); setNotificationsOpen(false); setProfileOpen(false); }}><MagnifyingGlass size={18} /></IconButton><IconButton label="通知" active={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setSearchOpen(false); setProfileOpen(false); }}><Bell size={18} /></IconButton></div></div>
    {searchOpen && <label className="sidebar-search"><MagnifyingGlass size={16} /><input aria-label="搜索项目和会话" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><IconButton label="清除搜索" onClick={() => setSearchQuery("")}><X size={14} /></IconButton></label>}
    {notificationsOpen && <div className="sidebar-popover notification-popover"><strong>通知</strong><span>当前没有新通知</span></div>}
    <nav className="sidebar-scroll"><section className="sidebar-section"><div className="section-heading"><span>独立会话</span><IconButton label="新建独立会话" onClick={props.onNewStandalone}><Plus size={17} /></IconButton></div><div className="sidebar-list">{standaloneThreads.map((thread) => <button type="button" key={thread.id} className={`sidebar-row ${props.activeThread?.type === "standalone" && props.activeThread.id === thread.id ? "is-selected" : ""}`} onClick={() => props.onSelectStandalone(thread)}><ChatCircle size={17} /><span>{thread.title}</span></button>)}</div></section>
      <div className="section-divider" />
      <section className="sidebar-section project-section"><div className="section-heading"><span>项目</span><IconButton label="添加项目" onClick={(event) => props.onAddProject(event.currentTarget)}><Plus size={17} /></IconButton></div><div className="project-tree">{projects.map((project) => { const expanded = props.expandedProjects.includes(project.id); return <div className="project-node" key={project.id}><div className="project-row-wrap"><button type="button" className="project-row" onClick={() => { props.onToggleProject(project.id); setProjectMenuId(null); }} onDoubleClick={() => props.onOpenProjectPath(project)} onContextMenu={(event) => { event.preventDefault(); setProjectMenuId(project.id); }}>{expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}<Folder size={18} /><span>{project.name}</span></button><IconButton label={`项目操作 ${project.name}`} className="project-action-button" active={projectMenuId === project.id} onClick={(event) => { event.stopPropagation(); setProjectMenuId((current) => current === project.id ? null : project.id); }}><DotsThree size={17} /></IconButton></div>
        {projectMenuId === project.id && <div className="project-action-popover" role="menu"><div className="project-location"><FolderOpen size={16} /><span><strong>{project.name}</strong><small title={project.path}>{project.path}</small></span></div><button type="button" onClick={() => { setProjectMenuId(null); props.onOpenProjectPath(project); }}><FolderOpen size={16} />在文件管理器中打开</button><button type="button" onClick={() => { setProjectMenuId(null); props.onCopyProjectPath(project); }}><Paperclip size={16} />复制项目路径</button><button type="button" onClick={() => { setProjectMenuId(null); props.onNewProjectThread(project); }}><Plus size={16} />新建项目会话</button><button type="button" className="danger-text" onClick={() => { setProjectMenuId(null); props.onRemoveProject(project); }}><Trash size={16} />从 Rux 移除</button></div>}
        {expanded && <div className="thread-children">{project.threads.map((thread) => <button type="button" key={thread.id} className={`sidebar-row child-row ${props.activeThread?.type === "project" && props.activeThread.id === thread.id ? "is-selected" : ""}`} onClick={() => props.onSelectProjectThread(project, thread)}><ChatCircle size={16} /><span>{thread.title}</span></button>)}<button type="button" className="sidebar-row child-row new-thread-row" onClick={() => props.onNewProjectThread(project)}><Plus size={16} /><span>新建项目会话</span></button></div>}
      </div>; })}</div></section></nav>
    {profileOpen && <div className="sidebar-popover profile-popover"><strong>{accountName}</strong><small>{email || (props.auth.connected ? "Codex 已连接" : "Codex 未登录")}</small><button type="button" onClick={props.onOpenSettings}><GearSix size={16} />设置</button></div>}
    <button type="button" className="profile-row" onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); setSearchOpen(false); }} aria-expanded={profileOpen}><span className="avatar avatar-small">{accountName.slice(0, 1).toUpperCase()}</span><span>{accountName}</span><CaretDown size={15} /></button>
  </aside>;
}
