import { useCallback, useRef, useState } from "react";
import type { RuxApi } from "../../electron/preload";
import type { ActiveThread, ProjectAction, ProjectRecord, ThreadRecord, WorkspaceState } from "../types";

type View = "project" | "standalone" | "review" | "settings";
type ModalStep = "choose" | "import" | "create";

export function useWorkspaceController(api: RuxApi, notify: (message: string) => void, onThreadsRemoved: (threadIds: string[]) => void, onThreadSelected: (thread: ThreadRecord) => void) {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ projects: [], standaloneThreads: [] });
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [defaultParent, setDefaultParent] = useState("");
  const [view, setView] = useState<View>("project");
  const [modalStep, setModalStep] = useState<ModalStep | null>(null);
  const [renameTarget, setRenameTarget] = useState<ActiveThread | null>(null);
  const previewDrafts = useRef(new Map<string, ThreadRecord>());
  const selectProjectThread = useCallback((project: ProjectRecord, thread: ThreadRecord) => {
    setActiveThread({ type: "project", projectId: project.id, projectName: project.name, projectPath: project.path, ...thread });
    setView("project"); onThreadSelected(thread);
  }, [onThreadSelected]);
  const selectStandalone = useCallback((thread: ThreadRecord) => { setActiveThread({ type: "standalone", ...thread }); setView("standalone"); onThreadSelected(thread); }, [onThreadSelected]);
  const reloadWorkspace = useCallback(async (selectProject?: ProjectRecord) => {
    const next = await api.projects.list() as WorkspaceState; setWorkspace(next);
    if (selectProject) {
      const project = next.projects.find((item) => item.id === selectProject.id) || selectProject;
      setExpandedProjects((current) => current.includes(project.id) ? current : [...current, project.id]);
      if (project.threads[0]) selectProjectThread(project, project.threads[0]);
    }
    return next;
  }, [api, selectProjectThread]);
  const newProjectThread = useCallback((project: ProjectRecord) => {
    const key = `draft:project:${project.id}`;
    const thread = previewDrafts.current.get(key) || { id: key, title: "未命名会话", draft: true };
    previewDrafts.current.set(key, thread);
    setExpandedProjects((current) => current.includes(project.id) ? current : [...current, project.id]);
    selectProjectThread(project, thread);
    return thread;
  }, [selectProjectThread]);
  const newStandalone = useCallback(() => {
    const key = "draft:standalone";
    const thread = previewDrafts.current.get(key) || { id: key, title: "未命名会话", draft: true };
    previewDrafts.current.set(key, thread);
    selectStandalone(thread);
    return thread;
  }, [selectStandalone]);
  const initializeWorkspace = useCallback(async (nextWorkspace: WorkspaceState, parent: string) => {
    setWorkspace(nextWorkspace); setDefaultParent(parent);
    const firstProject = nextWorkspace.projects[0]; const firstThread = firstProject?.threads[0];
    if (firstProject && firstThread) { setExpandedProjects([firstProject.id]); selectProjectThread(firstProject, firstThread); }
    else if (nextWorkspace.standaloneThreads[0]) selectStandalone(nextWorkspace.standaloneThreads[0]);
    else await newStandalone();
  }, [newStandalone, selectProjectThread, selectStandalone]);
  const renameThread = useCallback((thread: ActiveThread) => setRenameTarget(thread), []);
  const renameActiveThread = useCallback(() => { if (activeThread) setRenameTarget(activeThread); }, [activeThread]);
  const completeRename = useCallback(async (title: string) => {
    const thread = renameTarget; const nextTitle = title.trim(); if (!thread || !nextTitle) return;
    if (nextTitle === thread.title) { setRenameTarget(null); return; }
    if (thread.draft) { const updated = { ...thread, title: nextTitle }; previewDrafts.current.set(thread.id, updated); setActiveThread((current) => current?.id === thread.id ? { ...current, title: nextTitle } : current); setRenameTarget(null); notify("草稿名称已更新"); return; }
    try { const updated = await api.threads.update({ type: thread.type, projectId: thread.projectId, threadId: thread.id, title: nextTitle }); if (activeThread?.id === thread.id) setActiveThread((current) => current ? { ...current, ...(updated as Partial<ThreadRecord>) } : current); await reloadWorkspace(); setRenameTarget(null); notify("会话已重命名"); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [activeThread, api, notify, reloadWorkspace, renameTarget]);
  const removeThread = useCallback(async (thread: ActiveThread, running = false) => {
    if (running) { notify("请先停止该会话，再删除它"); return; }
    if (thread.draft) {
      previewDrafts.current.delete(thread.id);
      const project = thread.projectId ? workspace.projects.find((item) => item.id === thread.projectId) : undefined;
      if (project?.threads[0]) selectProjectThread(project, project.threads[0]);
      else if (workspace.standaloneThreads[0]) selectStandalone(workspace.standaloneThreads[0]);
      else await newStandalone();
      return;
    }
    if (!window.confirm(`删除会话“${thread.title}”？\n\n这会删除 Rux 中的会话记录及其底层 Agent 会话数据，但不会删除项目文件。此操作不可撤销。`)) return;
    try {
      const removed = await api.threads.remove({ type: thread.type, projectId: thread.projectId, threadId: thread.id }) as { workspace: WorkspaceState; cleanupWarning?: string }; const next = removed.workspace;
      setWorkspace(next); onThreadsRemoved([thread.id]);
      if (activeThread?.id === thread.id) {
        const sameProject = thread.type === "project" ? next.projects.find((item) => item.id === thread.projectId) : undefined;
        if (sameProject?.threads[0]) selectProjectThread(sameProject, sameProject.threads[0]);
        else if (next.standaloneThreads[0]) selectStandalone(next.standaloneThreads[0]);
        else { const project = next.projects.find((item) => item.threads.length); if (project) selectProjectThread(project, project.threads[0]); else await newStandalone(); }
      }
      notify(removed.cleanupWarning ? `会话记录已删除，但底层 Agent 数据清理失败：${removed.cleanupWarning}` : "会话及其底层 Agent 数据已删除");
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [activeThread, api, newStandalone, notify, onThreadsRemoved, selectProjectThread, selectStandalone, workspace]);
  const removeActiveThread = useCallback(async (sending: boolean) => { if (activeThread) await removeThread(activeThread, sending); }, [activeThread, removeThread]);
  const removeProject = useCallback(async (project: ProjectRecord, projectRunning = false) => {
    if (projectRunning) { notify("该项目仍有 Agent 正在运行，请先停止任务"); return; }
    if (!window.confirm(`从 Rux 中移除“${project.name}”？\n\n仅解除侧栏关联，不会删除磁盘中的项目文件。`)) return;
    try {
      const { workspace: rawWorkspace } = await api.projects.remove(project.id); const next = rawWorkspace as WorkspaceState; setWorkspace(next);
      onThreadsRemoved(project.threads.map((thread) => thread.id)); setExpandedProjects((current) => current.filter((id) => id !== project.id));
      if (activeThread?.type === "project" && activeThread.projectId === project.id) { const nextProject = next.projects[0]; if (nextProject?.threads[0]) selectProjectThread(nextProject, nextProject.threads[0]); else if (next.standaloneThreads[0]) selectStandalone(next.standaloneThreads[0]); }
      notify(`已移除 ${project.name}，本地文件未删除`);
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [activeThread, api, notify, onThreadsRemoved, selectProjectThread, selectStandalone]);
  const completeProjectAction = useCallback(async (action: ProjectAction) => {
    const diskAction = { ...action, createThread: false } as ProjectAction;
    const project = (diskAction.kind === "create" ? await api.projects.create(diskAction) : diskAction.kind === "clone" ? await api.projects.clone(diskAction) : await api.projects.import(diskAction)) as ProjectRecord;
    const next = await reloadWorkspace(); const stored = next.projects.find((item) => item.id === project.id) || project;
    if (action.createThread) newProjectThread(stored);
    else if (stored.threads[0]) selectProjectThread(stored, stored.threads[0]);
    setModalStep(null); notify(action.kind === "create" ? "项目已创建并加入侧栏" : "项目已导入并加入侧栏");
  }, [api, newProjectThread, notify, reloadWorkspace, selectProjectThread]);
  const completeDraft = useCallback((draftId: string) => { previewDrafts.current.delete(draftId); }, []);
  return { workspace, setWorkspace, activeThread, setActiveThread, expandedProjects, setExpandedProjects, defaultParent, view, setView, modalStep, setModalStep, renameTarget, setRenameTarget, initializeWorkspace, reloadWorkspace, selectProjectThread, selectStandalone, newProjectThread, newStandalone, completeDraft, renameThread, renameActiveThread, completeRename, removeThread, removeActiveThread, removeProject, completeProjectAction };
}
