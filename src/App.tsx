import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

// Renderer orchestration remains here; reusable UI and protocol state live in typed modules.
import {
  CheckCircle,
  CircleNotch,
  Code,
  WarningCircle,
} from "@phosphor-icons/react";
import { messageExportText } from "./renderer/messages";
import TypedSidebar from "./navigation/Sidebar";
import TypedTopBar from "./navigation/TopBar";
import TypedReviewScreen from "./workspace/ReviewScreen";
import EnvironmentPanel from "./workspace/EnvironmentPanel";
import ConversationScreen from "./conversation/ConversationScreen";
import RenameThreadModal from "./conversation/RenameThreadModal";
import AddProjectModal from "./projects/AddProjectModal";
import { FullAccessModal, ModelPopover, PermissionPopover, modelDisplayName, reasoningLabels, sandboxLabels, type ModelInfo, type Reasoning, type SandboxMode } from "./composer/ComposerControls";
import type { AgentId } from "./renderer/types";
import { usePersistentMessages } from "./renderer/hooks/usePersistentMessages";
import { useToast } from "./renderer/hooks/useToast";
import { useGitController } from "./renderer/hooks/useGitController";
import { useWorkspaceController } from "./renderer/hooks/useWorkspaceController";
import { useAgentRuns } from "./renderer/hooks/useAgentRuns";
import { useAppBootstrap, type AppSettings } from "./renderer/hooks/useAppBootstrap";
import { useWorkspaceTools } from "./renderer/hooks/useWorkspaceTools";
import { userFacingError } from "./renderer/errors";

const TypedSettingsScreen = lazy(() => import("./settings/SettingsScreen"));
const TypedWorkspaceDock = lazy(() => import("./workspace/WorkspaceDock"));

const api = window.rux;
type OverlayId = "agents" | "agent-mode" | "run-settings" | "sandbox";
type ComposerDraft = { text: string; attachments: string[]; webSearch: boolean };

function loadComposerDrafts(): Record<string, ComposerDraft> {
  try {
    const value = JSON.parse(localStorage.getItem("rux.composer-drafts.v1") || "{}") as Record<string, Partial<ComposerDraft>>;
    return Object.fromEntries(Object.entries(value).map(([key, draft]) => [key, { text: String(draft.text || ""), attachments: Array.isArray(draft.attachments) ? draft.attachments.map(String).slice(0, 8) : [], webSearch: Boolean(draft.webSearch) }]));
  } catch { return {}; }
}

function errorMessage(error: unknown): string { return userFacingError(error); }

function App() {
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("codex");
  const [agentMode, setAgentMode] = useState("default");
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const { toast, notify } = useToast();
  const [messages, setMessages] = usePersistentMessages(api, workspaceReady, notify);
  const [activeOverlay, setActiveOverlay] = useState<OverlayId | null>(null);
  const addProjectTrigger = useRef<HTMLButtonElement | null>(null);
  const modelOpen = activeOverlay === "run-settings";
  const sandboxOpen = activeOverlay === "sandbox";
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>(loadComposerDrafts);
  const [listening, setListening] = useState(false);
  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false);
  const handleThreadsRemoved = useCallback((threadIds: string[]) => { setMessages((current) => Object.fromEntries(Object.entries(current).filter(([threadId]) => !threadIds.includes(threadId)))); setComposerDrafts((current) => Object.fromEntries(Object.entries(current).filter(([threadId]) => !threadIds.includes(threadId)))); }, [setMessages]);
  const handleThreadSelected = useCallback((thread: { agentId?: AgentId; agentMode?: string }) => { setSelectedAgent(thread.agentId || "codex"); setAgentMode(thread.agentMode || "default"); setActiveOverlay(null); }, []);
  const { workspace, setWorkspace, activeThread, setActiveThread, expandedProjects, setExpandedProjects, defaultParent, view, setView, modalStep, setModalStep, renameTarget, setRenameTarget, initializeWorkspace, reloadWorkspace, selectProjectThread, selectStandalone, newProjectThread, newStandalone, completeDraft, renameThread, renameActiveThread, completeRename, removeThread, removeActiveThread: removeWorkspaceThread, removeProject, completeProjectAction } = useWorkspaceController(
    api,
    notify,
    handleThreadsRemoved,
    handleThreadSelected,
  );

  const draftKey = activeThread?.id || "";
  const activeDraft = composerDrafts[draftKey] || { text: "", attachments: [], webSearch: false };
  const composerValue = activeDraft.text;
  const attachments = activeDraft.attachments;
  const webSearch = activeDraft.webSearch;
  const updateActiveDraft = useCallback((update: (current: ComposerDraft) => ComposerDraft) => { if (!draftKey) return; setComposerDrafts((current) => ({ ...current, [draftKey]: update(current[draftKey] || { text: "", attachments: [], webSearch: false }) })); }, [draftKey]);
  const setComposerValue = useCallback((next: string | ((current: string) => string)) => updateActiveDraft((current) => ({ ...current, text: typeof next === "function" ? next(current.text) : next })), [updateActiveDraft]);
  const setAttachments = useCallback((next: string[] | ((current: string[]) => string[])) => updateActiveDraft((current) => ({ ...current, attachments: typeof next === "function" ? next(current.attachments) : next })), [updateActiveDraft]);
  const setWebSearch = useCallback((next: boolean | ((current: boolean) => boolean)) => updateActiveDraft((current) => ({ ...current, webSearch: typeof next === "function" ? next(current.webSearch) : next })), [updateActiveDraft]);
  const handleDraftPersisted = useCallback((id: string) => { completeDraft(id); setComposerDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))); }, [completeDraft]);
  useEffect(() => {
    const retained = Object.fromEntries(Object.entries(composerDrafts).filter(([, draft]) => draft.text.trim() || draft.attachments.length || draft.webSearch));
    localStorage.setItem("rux.composer-drafts.v1", JSON.stringify(retained));
  }, [composerDrafts]);

  const activeMessages = activeThread ? messages[activeThread.id] || [] : [];
  const environmentSources = [...new Set([...activeMessages.flatMap((message) => Array.isArray(message.attachments) ? message.attachments.map(String) : []), ...attachments])];
  const isStandalone = activeThread?.type === "standalone";
  const activeProject = activeThread?.type === "project" ? workspace.projects.find((project) => project.id === activeThread.projectId) ?? null : null;
  const { settings, setSettings, auth, setAuth, models, modelsByAgent, agents, agentPreferences, setAgentPreferences, providerStore, runtimeProgress, systemInfo, modelsLoading, modelsError, codexModelsLoading, codexModelsError, fatalError, saveSettings, testSettings, saveProvider, removeProvider, setActiveProvider } = useAppBootstrap(api, selectedAgent, activeProject?.id, workspaceReady, setWorkspaceReady, initializeWorkspace, setMessages);
  const customModels: ModelInfo[] = settings.provider === "custom" && settings.model ? [{ id: `custom:${settings.model}`, model: settings.model, displayName: settings.model, description: settings.serviceName, isDefault: true, defaultReasoningEffort: settings.reasoning, supportedReasoningEfforts: [{ reasoningEffort: settings.reasoning, description: `${settings.serviceName} · ${settings.reasoning}` }] }] : [];
  const activeModels = selectedAgent === "codex" ? settings.provider === "custom" ? customModels : models : modelsByAgent[selectedAgent] || [];
  const activePreference = selectedAgent === "codex"
    ? { model: settings.model, reasoning: settings.reasoning, serviceTier: agentPreferences.codex.serviceTier }
    : agentPreferences[selectedAgent] || { model: "default", reasoning: "high", serviceTier: null };
  const activeSandboxMode: SandboxMode = selectedAgent === "pi" && settings.sandboxMode === "workspace-write" ? "read-only" : settings.sandboxMode;
  const supportsSandbox = selectedAgent === "pi" || (selectedAgent === "codex" && settings.provider === "codex");
  const activeRunSettings: AppSettings = { ...settings, sandboxMode: activeSandboxMode };
  const activeComposerSettings: AppSettings = { ...activeRunSettings, ...activePreference, provider: selectedAgent === "codex" ? settings.provider : "codex" };
  const { gitState, branches, selectedFile, diff, busy, comparisonBase, selectDiff, refreshGit, switchBranch, stage, discardSelected, commitOrPush, openReview, compareBranch, closeReview } = useGitController(api, activeProject?.id, notify, setView);
  const { bottomPanelOpen, setBottomPanelOpen, rightPanelOpen, setRightPanelOpen, activeTool, projectFiles, remoteUrl, sideMessages, sideValue, setSideValue, sideSending, sideApproval, sideAgentLabel, closeBottomPanel, toggleBottomPanel, selectWorkspaceTool, openRemote, sendSideChat, respondToSideApproval, cancelSideChat, terminalStarting, terminalOutput, writeTerminalInput, resizeTerminal } = useWorkspaceTools(api, activeProject?.id, selectedAgent, agentMode, activePreference, activeRunSettings, refreshGit, notify);
  const { sending, runningThreadIds, sendMessage: sendAgentMessage, cancelCurrentRun, respondToApproval, isThreadRunning, isProjectRunning } = useAgentRuns({ api, activeThread, activeProjectId: activeProject?.id, selectedAgent, agentMode, preference: activePreference, settings: activeRunSettings, attachments, webSearch, agents, setMessages, setAttachments, setComposerValue, setActiveThread, reloadWorkspace, refreshGit, notify, onDraftPersisted: handleDraftPersisted });
  const sendMessage = (prompt: string = composerValue) => sendAgentMessage(prompt);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === ",") { event.preventDefault(); setView("settings"); }
      if (event.metaKey && event.key.toLowerCase() === "b") { event.preventDefault(); setLeftPanelOpen((open) => !open); }
      if (event.metaKey && event.key.toLowerCase() === "n") { event.preventDefault(); newStandalone(); }
      if (event.ctrlKey && event.key === "`") { event.preventDefault(); selectWorkspaceTool("terminal"); }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "g") { event.preventDefault(); openReview(); }
      if (event.key === "Escape") setActiveOverlay(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  async function copyConversation() {
    const title = activeThread?.title || "Rux 会话";
    const body = activeMessages.map((message) => `## ${message.role === "user" ? "用户" : "Rux"}\n\n${messageExportText(message)}`).join("\n\n");
    await api.system.copy(`# ${title}\n\n${body || "暂无消息"}`);
    notify("会话内容已复制");
  }

  async function addFiles() {
    try {
      const paths = await api.system.chooseFiles();
      setAttachments((current) => [...new Set([...current, ...paths])].slice(0, 8));
    } catch (error) { notify(errorMessage(error)); }
  }

  async function selectSandbox(sandboxMode: SandboxMode) {
    if (sending && sandboxMode !== activeSandboxMode) { setActiveOverlay(null); notify("请先停止当前任务；权限变更会从下一轮对话开始生效"); return; }
    if (selectedAgent === "pi" && sandboxMode === "workspace-write") { setActiveOverlay(null); notify("Pi RPC 暂不支持逐次操作审批，请选择只读模式或完整访问"); return; }
    if (sandboxMode === "danger-full-access" && settings.sandboxMode !== "danger-full-access") { setActiveOverlay(null); setFullAccessConfirmOpen(true); return; }
    try { await saveSettings({ sandboxMode }); setActiveOverlay(null); notify(`权限已切换为${sandboxLabels[sandboxMode]}`); }
    catch (error) { notify(errorMessage(error)); }
  }

  async function confirmFullAccess() {
    try { await saveSettings({ sandboxMode: "danger-full-access" }); setFullAccessConfirmOpen(false); notify("完整访问权限已开启"); }
    catch (error) { notify(errorMessage(error)); }
  }

  function toggleVoice() {
    if (listening) { window.__ruxSpeechRecognition?.stop(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { notify("当前系统不支持语音转写"); return; }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => { const text = Array.from(event.results as any[]).map((result: any) => result[0].transcript).join(""); setComposerValue(text); };
    recognition.onerror = (event: any) => notify(`语音输入失败：${event.error}`);
    recognition.onend = () => { setListening(false); window.__ruxSpeechRecognition = null; };
    window.__ruxSpeechRecognition = recognition;
    recognition.start();
  }

  async function selectModel(model: ModelInfo) {
    try {
      const supported = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
      const reasoning = supported.includes(activePreference.reasoning) ? activePreference.reasoning : model.defaultReasoningEffort;
      const serviceTier = model.serviceTiers?.some((tier) => tier.id === activePreference.serviceTier) ? activePreference.serviceTier : model.defaultServiceTier || null;
      if (selectedAgent === "codex") {
        await saveSettings({ model: model.model, reasoning });
        setAgentPreferences((current) => ({ ...current, codex: { model: model.model, reasoning, serviceTier } }));
      } else {
        setAgentPreferences((current) => ({ ...current, [selectedAgent]: { model: model.model, reasoning, serviceTier } }));
      }
      setActiveOverlay(null);
      notify(`已切换到 ${model.displayName}`);
    } catch (error) { notify(errorMessage(error)); }
  }

  async function selectReasoning(reasoning: Reasoning) {
    try {
      if (selectedAgent === "codex") {
        await saveSettings({ reasoning });
        setAgentPreferences((current) => ({ ...current, codex: { ...current.codex, reasoning } }));
      } else {
        setAgentPreferences((current) => ({ ...current, [selectedAgent]: { ...current[selectedAgent], reasoning } }));
      }
      setActiveOverlay(null);
      notify(`思考程度已切换为${reasoningLabels[reasoning] || reasoning}`);
    } catch (error) { notify(errorMessage(error)); }
  }

  function selectServiceTier(serviceTier: string | null) {
    setAgentPreferences((current) => ({ ...current, [selectedAgent]: { ...current[selectedAgent], serviceTier } }));
    setActiveOverlay(null);
    notify(serviceTier === "priority" ? "速度已切换为快速" : "速度已切换为标准");
  }

  if (fatalError) return <div className="fatal-screen"><WarningCircle size={32} /><h1>Rux 无法启动</h1><p>{fatalError}</p></div>;
  if (!activeThread) return <div className="fatal-screen"><CircleNotch size={30} className="spin" /><p>正在加载工作区…</p></div>;
  if (view === "settings") return <div className="app-frame"><Suspense fallback={<div className="fatal-screen"><CircleNotch size={30} className="spin" /><p>正在加载设置…</p></div>}><TypedSettingsScreen settings={settings} auth={auth} models={models} modelsLoading={codexModelsLoading} modelsError={codexModelsError} agents={agents} modelsByAgent={modelsByAgent} providerStore={providerStore} onProviderSave={saveProvider} onProviderRemove={removeProvider} onProviderSetActive={setActiveProvider} onProviderTest={(id) => api.providers.test(id)} systemInfo={systemInfo} projectCount={workspace.projects.length} activeProject={activeProject} gitState={gitState} permissionChangesLocked={sending} onBack={() => setView(isStandalone ? "standalone" : "project")} onSave={async (input: Partial<AppSettings> & { apiKey?: string }) => { if (sending && input.sandboxMode && input.sandboxMode !== settings.sandboxMode) throw new Error("请先停止当前任务；权限变更会从下一轮对话开始生效"); return await saveSettings(input); }} onTest={testSettings} onLogin={async () => { await api.auth.login(); return "设备登录已启动，请按账户区域中的提示完成验证"; }} onLogout={async () => { await api.auth.logout(); setAuth(await api.auth.status()); return "已退出"; }} onNotify={notify} /></Suspense>{toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={18} />{toast}</div>}</div>;

  const toggleOverlay = (overlay: OverlayId) => setActiveOverlay((current) => current === overlay ? null : overlay);
  const removeAttachment = (path: string) => setAttachments((current) => current.filter((item) => item !== path));
  const closeProjectModal = () => { setModalStep(null); requestAnimationFrame(() => addProjectTrigger.current?.focus()); };
  const assistantProps = {
    projectId: activeProject?.id,
    messages: activeMessages,
    running: sending,
    onNewMessage: sendMessage,
    onCancel: cancelCurrentRun,
    onApproval: respondToApproval,
    conversationSticky: settings.conversationSticky,
    agents,
    runtimeProgress,
    selectedAgent,
    onSelectAgent: async (agentId: AgentId) => {
      if (sending || sideSending) { notify("请先停止当前任务，再切换 Agent"); return; }
      const agent = agents.find((item) => item.id === agentId);
      if (!agent?.integrated) { notify(`${agent?.name || agentId} 适配器尚未启用`); return; }
      if (agentId === selectedAgent) return;
      const boundAgent = activeThread.agentId || (activeThread.codexThreadId ? "codex" : null);
      if (activeMessages.length || (boundAgent && boundAgent !== agentId) || activeThread.nativeSessionId) {
        if (!window.confirm(`当前会话已绑定 ${agents.find((item) => item.id === selectedAgent)?.name || selectedAgent}。\n\n切换到 ${agent.name} 将新建一个空白 Rux 会话，当前会话会保留。`)) return;
        if (activeProject) {
          newProjectThread(activeProject);
        } else {
          newStandalone();
        }
      }
      setSelectedAgent(agentId);
      setAgentMode(agent.modes?.[0]?.id || "default");
      setAttachments([]);
      if (agentId === "pi" && settings.sandboxMode === "workspace-write") notify("Pi 不支持逐次操作审批，当前会话已安全使用只读模式");
    },
    agentMode,
    onAgentMode: (mode: string) => {
      if (mode === "bypass-permissions" && !window.confirm("绕过权限会允许 Claude Code 在不询问的情况下执行命令和修改文件。确认启用？")) return;
      setAgentMode(mode);
    },
    modelLabel: modelDisplayName(activeComposerSettings, activeModels),
    reasoningLabel: reasoningLabels[activePreference.reasoning] || activePreference.reasoning,
    permissionLabel: selectedAgent === "pi" && activeSandboxMode === "read-only" ? "只读模式" : sandboxLabels[activeSandboxMode] || "帮我批准",
    permissionMode: activeSandboxMode,
    permissionDanger: supportsSandbox && activeSandboxMode === "danger-full-access",
    showPermission: supportsSandbox,
    modelOpen,
    sandboxOpen,
    activeOverlay,
    onOverlayChange: setActiveOverlay,
    modelPopover: modelOpen ? <ModelPopover settings={activeComposerSettings} auth={auth} models={activeModels} loading={settings.provider === "custom" && selectedAgent === "codex" ? false : modelsLoading} error={settings.provider === "custom" && selectedAgent === "codex" ? "" : modelsError} serviceTier={activePreference.serviceTier} onSelectModel={selectModel} onSelectReasoning={selectReasoning} onSelectServiceTier={selectServiceTier} /> : null,
    permissionPopover: <PermissionPopover agentId={selectedAgent === "pi" ? "pi" : "codex"} selectedValue={activeSandboxMode} onSelect={selectSandbox} onLearnMore={() => notify(selectedAgent === "pi" ? "Pi RPC 不提供逐次审批，因此 Rux 仅开放可真实执行的只读或完整访问模式" : "可在设置 > 权限中修改默认批准方式")} />,
    onToggleModel: () => toggleOverlay("run-settings"),
    onToggleSandbox: () => toggleOverlay("sandbox"),
    attachments,
    showAttachments: true,
    webSearch,
    showWebSearch: selectedAgent === "codex" && settings.provider === "codex",
    onToggleWebSearch: () => setWebSearch((enabled) => !enabled),
    draftKey,
    draftText: composerValue,
    onDraftTextChange: (text: string) => setComposerValue(text),
    onAddFiles: addFiles,
    onRemoveAttachment: removeAttachment,
    listening,
    onVoice: toggleVoice,
  };
  return (
    <div className="app-frame">
      {leftPanelOpen && <TypedSidebar workspace={workspace} auth={auth} expandedProjects={expandedProjects} activeThread={activeThread} runningThreadIds={runningThreadIds} onToggleProject={(projectId) => setExpandedProjects((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])} onSelectProjectThread={selectProjectThread} onSelectStandalone={selectStandalone} onAddProject={(trigger) => { addProjectTrigger.current = trigger; setModalStep("choose"); }} onRemoveProject={(project) => { void removeProject(project, isProjectRunning(project.id)); }} onOpenProjectPath={(project) => api.system.openPath(project.id).catch((error) => notify(errorMessage(error)))} onCopyProjectPath={(project) => api.system.copy(project.path).then(() => notify("项目路径已复制"))} onNewProjectThread={newProjectThread} onNewStandalone={newStandalone} onRenameThread={(thread) => { void renameThread(thread); }} onDeleteThread={(thread) => { void removeThread(thread, isThreadRunning(thread.id)); }} onOpenSettings={() => setView("settings")} />}
      <main className="app-stage">
        <TypedTopBar activeThread={activeThread} leftPanelOpen={leftPanelOpen} bottomPanelOpen={bottomPanelOpen} rightPanelOpen={rightPanelOpen} onToggleLeftPanel={() => setLeftPanelOpen((open) => !open)} onToggleBottomPanel={toggleBottomPanel} onToggleRightPanel={() => setRightPanelOpen((open) => !open)} onOpenSettings={() => setView("settings")} onOpenPath={() => activeProject && api.system.openPath(activeProject.id).catch((error) => notify(errorMessage(error)))} onCopyPath={() => activeProject && api.system.copy(activeProject.path).then(() => notify("项目路径已复制"))} onShare={copyConversation} onRename={renameActiveThread} onRemoveThread={() => { void removeWorkspaceThread(sending); }} />
        <div className={`stage-body ${bottomPanelOpen ? "bottom-panel-is-open" : ""}`}>
          <div className="work-pane">
            <div className="main-content">{view === "review" ? <TypedReviewScreen gitState={gitState} branches={branches} selectedFile={selectedFile} diff={diff} comparisonBase={comparisonBase} onSelectFile={selectDiff} onBack={closeReview} onSwitchBranch={switchBranch} onCommitPush={commitOrPush} onStageAll={() => stage(gitState.files.map((file) => file.path))} onStageFile={() => stage([selectedFile])} onDiscard={discardSelected} busy={busy} /> : <ConversationScreen standalone={isStandalone} activeThread={activeThread} assistantProps={assistantProps} gitState={gitState} onReview={openReview} />}</div>
            {rightPanelOpen && <EnvironmentPanel hasProject={Boolean(activeProject)} gitState={gitState} branches={branches} sources={environmentSources} busy={busy} onOpenReview={openReview} onOpenPath={() => activeProject && api.system.openPath(activeProject.id).catch((error) => notify(errorMessage(error)))} onSwitchBranch={switchBranch} onCompareBranch={compareBranch} onCommitPush={commitOrPush} onAddSource={addFiles} />}
          </div>
          {bottomPanelOpen && <Suspense fallback={<div className="workspace-dock"><div className="runtime-inline-progress"><CircleNotch size={13} className="spin" /><span>正在加载工作区工具…</span></div></div>}><TypedWorkspaceDock activeTool={activeTool} hasProject={Boolean(activeProject)} gitState={gitState} terminalProps={{ starting: terminalStarting, output: terminalOutput, onInput: writeTerminalInput, onResize: resizeTerminal }} remoteUrl={remoteUrl} projectFiles={projectFiles} sideMessages={sideMessages} sideValue={sideValue} sideSending={sideSending} sideApproval={sideApproval} sideAgentLabel={sideAgentLabel} onSelectTool={selectWorkspaceTool} onClose={closeBottomPanel} onOpenReview={() => { setView("review"); setBottomPanelOpen(false); }} onOpenRemote={openRemote} onOpenFile={(path) => activeProject && api.files.open({ projectId: activeProject.id, path }).catch((error) => notify(errorMessage(error)))} onSideValue={setSideValue} onSendSide={sendSideChat} onSideApproval={respondToSideApproval} onCancelSide={cancelSideChat} /></Suspense>}
        </div>
      </main>
      {modalStep && <AddProjectModal step={modalStep} defaultParent={defaultParent} onClose={closeProjectModal} onStep={setModalStep} onComplete={completeProjectAction} onChooseDirectory={() => api.projects.chooseDirectory()} />}
      {renameTarget && <RenameThreadModal currentTitle={renameTarget.title} onClose={() => setRenameTarget(null)} onSubmit={completeRename} />}
      {fullAccessConfirmOpen && <FullAccessModal onCancel={() => setFullAccessConfirmOpen(false)} onConfirm={confirmFullAccess} onLearnMore={() => notify("完整访问权限会跳过逐次批准；可随时在权限菜单或设置中关闭")} />}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={18} />{toast}</div>}
    </div>
  );
}

export default App;
