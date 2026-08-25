import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  Bell,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Check,
  CheckCircle,
  CircleNotch,
  Code,
  DotsThree,
  DownloadSimple,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GearSix,
  GitBranch,
  Globe,
  Keyboard,
  LockKey,
  MagnifyingGlass,
  Microphone,
  Monitor,
  Paperclip,
  Palette,
  Plus,
  ShareNetwork,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  TerminalWindow,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const api = window.rux;

const fallbackWorkspace = {
  projects: [],
  standaloneThreads: [
    { id: "compare", title: "比较模型响应" },
    { id: "logs", title: "解释错误日志" },
  ],
};

const fallbackSettings = {
  provider: "codex",
  serviceName: "OpenAI Compatible",
  baseUrl: "https://api.openai.com/v1",
  hasApiKey: false,
  model: "",
  reasoning: "high",
  allowConversationOverride: true,
};

const reasoningLabels = { none: "无", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大", ultra: "Ultra" };

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem("rux.messages.v1") || "{}");
  } catch {
    return {};
  }
}

function IconButton({ label, children, active = false, onClick, className = "", disabled = false }) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Sidebar({
  workspace,
  expandedProjects,
  activeThread,
  onToggleProject,
  onSelectProjectThread,
  onSelectStandalone,
  onAddProject,
  onRemoveProject,
  onNewProjectThread,
  onNewStandalone,
  onOpenSettings,
}) {
  return (
    <aside className="sidebar" aria-label="Rux 导航">
      <div className="sidebar-brand-row">
        <strong className="brand">Rux</strong>
        <div className="sidebar-actions">
          <IconButton label="搜索"><MagnifyingGlass size={18} /></IconButton>
          <IconButton label="通知"><Bell size={18} /></IconButton>
        </div>
      </div>
      <nav className="sidebar-scroll">
        <section className="sidebar-section">
          <div className="section-heading">
            <span>独立会话</span>
            <IconButton label="新建独立会话" onClick={onNewStandalone}><Plus size={17} /></IconButton>
          </div>
          <div className="sidebar-list">
            {workspace.standaloneThreads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                className={`sidebar-row ${activeThread?.type === "standalone" && activeThread.id === thread.id ? "is-selected" : ""}`}
                onClick={() => onSelectStandalone(thread)}
              >
                <ChatCircle size={17} /><span>{thread.title}</span>
              </button>
            ))}
          </div>
        </section>
        <div className="section-divider" />
        <section className="sidebar-section project-section">
          <div className="section-heading">
            <span>项目</span>
            <IconButton label="添加项目" onClick={onAddProject}><Plus size={17} /></IconButton>
          </div>
          <div className="project-tree">
            {workspace.projects.map((project) => {
              const expanded = expandedProjects.includes(project.id);
              return (
                <div className="project-node" key={project.id}>
                  <div className="project-row-wrap">
                    <button type="button" className="project-row" onClick={() => onToggleProject(project.id)}>
                      {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                      <Folder size={18} /><span>{project.name}</span>
                    </button>
                    <IconButton label={`移除项目 ${project.name}`} className="remove-project-button" onClick={() => onRemoveProject(project)}><Trash size={15} /></IconButton>
                  </div>
                  {expanded && (
                    <div className="thread-children">
                      {project.threads.map((thread) => (
                        <button
                          type="button"
                          key={thread.id}
                          className={`sidebar-row child-row ${activeThread?.type === "project" && activeThread.id === thread.id ? "is-selected" : ""}`}
                          onClick={() => onSelectProjectThread(project, thread)}
                        >
                          <ChatCircle size={16} /><span>{thread.title}</span>
                        </button>
                      ))}
                      <button type="button" className="sidebar-row child-row new-thread-row" onClick={() => onNewProjectThread(project)}>
                        <Plus size={16} /><span>新建项目会话</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </nav>
      <button type="button" className="profile-row" onClick={onOpenSettings}>
        <span className="avatar avatar-small">S</span><span>SuperZ</span><CaretDown size={15} />
      </button>
    </aside>
  );
}

function TopBar({ activeThread, rightPanelOpen, onToggleRightPanel, onOpenSettings, onOpenPath }) {
  const isProject = activeThread?.type === "project";
  return (
    <header className="topbar">
      <div className="topbar-title">
        {isProject ? <Folder size={19} /> : <ChatCircle size={19} />}
        {isProject && <span className="muted-title">{activeThread.projectName}</span>}
        {isProject && <span className="title-separator">/</span>}
        <strong>{activeThread?.title || "Rux"}</strong>
        {!isProject && <span className="standalone-badge">独立会话</span>}
        <IconButton label="更多"><DotsThree size={20} /></IconButton>
      </div>
      <div className="topbar-actions">
        <IconButton label="分享"><ShareNetwork size={18} /></IconButton>
        {isProject && <button type="button" className="toolbar-button" onClick={onOpenPath}>打开位置<CaretDown size={14} /></button>}
        <IconButton label="切换侧边面板" active={rightPanelOpen} onClick={onToggleRightPanel}><SidebarSimple size={19} /></IconButton>
        <IconButton label="设置" onClick={onOpenSettings}><GearSix size={18} /></IconButton>
      </div>
    </header>
  );
}

function EnvironmentPanel({ gitState, onReview }) {
  const plus = gitState.files.reduce((total, file) => total + file.plus, 0);
  const minus = gitState.files.reduce((total, file) => total + file.minus, 0);
  return (
    <aside className="environment-panel">
      <div className="panel-heading"><span>环境信息</span><Plus size={17} /></div>
      <button type="button" className="environment-row" onClick={onReview}>
        <FileText size={18} /><strong>变更</strong>
        <span className="change-count"><b>+{plus}</b> <em>−{minus}</em></span>
      </button>
      <div className="environment-row"><Monitor size={18} /><strong>本地</strong></div>
      <div className="environment-row"><GitBranch size={18} /><span>{gitState.branch || "—"}</span><CaretDown size={15} className="row-end" /></div>
      <div className="environment-row is-disabled"><ArrowUp size={18} /><span>提交或推送</span></div>
      <button type="button" className="environment-row" onClick={onReview}><GitBranch size={18} /><strong>查看变更</strong><ArrowSquareOut size={15} className="row-end" /></button>
    </aside>
  );
}

function UtilityPanel() {
  return (
    <aside className="utility-panel">
      <button type="button"><Globe size={19} /><span>搜索网页</span></button>
      <button type="button"><Paperclip size={19} /><span>添加文件</span></button>
    </aside>
  );
}

function ToolLauncher() {
  return (
    <aside className="tool-launcher" aria-label="工作区工具">
      <button type="button"><FileText size={19} /><span>审查</span><kbd>⌃⇧G</kbd></button>
      <button type="button" className="is-active"><TerminalWindow size={19} /><span>终端</span><kbd>⌃`</kbd></button>
      <button type="button"><Globe size={19} /><span>浏览器</span><kbd>⌘T</kbd></button>
      <button type="button"><FolderOpen size={19} /><span>文件</span><kbd>⌘P</kbd></button>
      <button type="button"><ChatCircle size={19} /><span>侧边聊天</span><kbd>⌥⌘S</kbd></button>
    </aside>
  );
}

function selectedCodexModel(settings, models) {
  return models.find((model) => model.model === settings.model)
    || models.find((model) => model.isDefault)
    || models[0];
}

function modelDisplayName(settings, models) {
  return selectedCodexModel(settings, models)?.displayName || settings.model || "默认模型";
}

function ModelPopover({ mode, settings, auth, models, loading, error, onSelectModel, onSelectReasoning }) {
  const selectedModel = selectedCodexModel(settings, models);
  const efforts = selectedModel?.supportedReasoningEfforts
    || Object.keys(reasoningLabels).map((reasoningEffort) => ({ reasoningEffort, description: "" }));
  return (
    <div className={`model-popover ${mode === "models" ? "model-picker-popover" : "reasoning-picker-popover"}`} role="dialog" aria-label={mode === "models" ? "选择模型" : "选择思考程度"}>
      <div className="popover-heading"><strong>{mode === "models" ? "选择模型" : "思考程度"}</strong><span className={auth.connected ? "status-dot" : "status-dot offline"} /></div>
      {loading && <div className="picker-state"><CircleNotch size={16} className="spin" />正在读取 Codex 配置…</div>}
      {error && <div className="picker-state error-text">{error}</div>}
      {!loading && mode === "models" && models.map((model) => {
        const selected = selectedModel?.model === model.model;
        return (
          <button type="button" className={`picker-option ${selected ? "is-selected" : ""}`} key={model.id} onClick={() => onSelectModel(model)}>
            <span><strong>{model.displayName}</strong><small>{model.description}</small></span>
            {model.isDefault && <em>默认</em>}{selected && <Check size={17} weight="bold" />}
          </button>
        );
      })}
      {!loading && mode === "reasoning" && efforts.map((effort) => {
        const selected = settings.reasoning === effort.reasoningEffort;
        return (
          <button type="button" className={`picker-option ${selected ? "is-selected" : ""}`} key={effort.reasoningEffort} onClick={() => onSelectReasoning(effort.reasoningEffort)}>
            <span><strong>{reasoningLabels[effort.reasoningEffort] || effort.reasoningEffort}</strong><small>{effort.description}</small></span>
            {selected && <Check size={17} weight="bold" />}
          </button>
        );
      })}
      <div className="popover-footer">{settings.provider === "codex" ? `${modelDisplayName(settings, models)} · GPT OAuth` : settings.serviceName}</div>
    </div>
  );
}

function Composer({ standalone, settings, auth, models, modelsLoading, modelsError, modelOpen, onToggleModel, onSelectModel, onSelectReasoning, onAssociateProject, value, onChange, onSend, sending }) {
  return (
    <form className="composer-wrap" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      {modelOpen && <ModelPopover mode={modelOpen} settings={settings} auth={auth} models={models} loading={modelsLoading} error={modelsError} onSelectModel={onSelectModel} onSelectReasoning={onSelectReasoning} />}
      <div className="composer">
        <textarea aria-label="消息" placeholder="向 Rux 发送消息" rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={sending} />
        <div className="composer-controls">
          <div className="composer-left">
            <IconButton label="添加上下文"><Plus size={20} /></IconButton>
            {standalone ? (
              <><button type="button" className="scope-button neutral"><FolderOpen size={17} />独立沙盒<CaretDown size={13} /></button><button type="button" className="text-action" onClick={onAssociateProject}>关联到项目</button></>
            ) : (
              <button type="button" className="scope-button"><ShieldCheck size={17} />项目写入<CaretDown size={13} /></button>
            )}
          </div>
          <div className="composer-right">
            <button type="button" className={`composer-menu ${modelOpen === "models" ? "is-active" : ""}`} aria-expanded={modelOpen === "models"} onClick={() => onToggleModel("models")}>{modelDisplayName(settings, models)}<CaretDown size={13} /></button>
            <button type="button" className={`composer-menu ${modelOpen === "reasoning" ? "is-active" : ""}`} aria-expanded={modelOpen === "reasoning"} onClick={() => onToggleModel("reasoning")}>{reasoningLabels[settings.reasoning] || settings.reasoning}<CaretDown size={13} /></button>
            <IconButton label="语音输入"><Microphone size={19} /></IconButton>
            <button type="submit" className="send-button" aria-label="发送" disabled={sending || !value.trim()}>{sending ? <CircleNotch size={20} className="spin" /> : <ArrowUp size={20} weight="bold" />}</button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Conversation({ messages, sending, emptyTitle }) {
  if (!messages.length && !sending) {
    return <div className="conversation-empty"><ChatCircle size={32} /><h2>{emptyTitle}</h2><p>输入任务后，Rux 将调用真实的本机 Codex 会话。</p></div>;
  }
  return (
    <div className="conversation-scroll">
      {messages.map((message) => (
        <div className={`message ${message.role === "user" ? "user-message" : "agent-message"}`} key={message.id}>
          <span className={`avatar ${message.role === "assistant" ? "avatar-dark" : ""}`}>{message.role === "assistant" ? "R" : "S"}</span>
          {message.role === "user" ? <div className="message-bubble">{message.text}</div> : <div className="agent-copy"><p className={message.error ? "error-text" : ""}>{message.text}</p></div>}
        </div>
      ))}
      {sending && <div className="message agent-message"><span className="avatar avatar-dark">R</span><div className="agent-copy agent-loading"><CircleNotch size={18} className="spin" />Codex 正在处理任务…</div></div>}
    </div>
  );
}

function ConversationScreen({ standalone, activeThread, messages, sending, composerProps, gitState, onReview, terminalOpen, onToggleTerminal }) {
  return (
    <div className={`conversation-screen ${standalone ? "standalone-screen" : ""}`}>
      <Conversation messages={messages} sending={sending} emptyTitle={standalone ? "开始独立会话" : `在 ${activeThread.projectName} 中开始任务`} />
      {!standalone && gitState.files.length > 0 && (
        <div className="live-change-summary"><FileText size={18} /><strong>{gitState.files.length} 个真实文件变更</strong><button type="button" className="secondary-button" onClick={onReview}><Eye size={17} />审查变更</button></div>
      )}
      <Composer standalone={standalone} {...composerProps} />
      {!standalone && <button type="button" className={`terminal-toggle ${terminalOpen ? "is-open" : ""}`} onClick={onToggleTerminal}><span><TerminalWindow size={18} />终端</span>{terminalOpen ? <CaretDown size={15} /> : <CaretRight size={15} />}</button>}
    </div>
  );
}

function TerminalPanel({ output, command, onCommandChange, onRun, onClose, projectName }) {
  return (
    <section className="terminal-panel">
      <div className="terminal-tabs"><div className="terminal-tab"><TerminalWindow size={17} /><span>{projectName}</span></div><IconButton label="关闭终端" className="terminal-close" onClick={onClose}><X size={18} /></IconButton></div>
      <pre className="terminal-body" aria-label="终端输出">{output || "终端已启动\n"}</pre>
      <form className="terminal-command" onSubmit={(event) => { event.preventDefault(); onRun(); }}>
        <span>$</span><input aria-label="终端命令" value={command} onChange={(event) => onCommandChange(event.target.value)} autoComplete="off" /><button type="submit" className="secondary-button">运行</button>
      </form>
    </section>
  );
}

function ReviewScreen({ gitState, selectedFile, diff, onSelectFile, onBack, onStageAll, onStageFile, onDiscard, busy }) {
  return (
    <div className="review-screen">
      <div className="review-tabs"><button type="button" onClick={onBack}>对话</button><button type="button" className="is-active">变更 <span>{gitState.files.length}</span></button></div>
      <div className="review-summary"><span><FileText size={18} />{gitState.files.length} 个真实文件变更</span><span className="tests-passed"><GitBranch size={18} />{gitState.branch || "—"}</span></div>
      {gitState.files.length ? (
        <div className="review-workspace">
          <div className="file-list">{gitState.files.map((file) => <button type="button" key={file.path} className={selectedFile === file.path ? "is-selected" : ""} onClick={() => onSelectFile(file.path)}><File size={17} /><span>{file.path}</span><small><b>+{file.plus}</b> <em>−{file.minus}</em></small></button>)}</div>
          <div className="real-diff-wrap"><div className="diff-heading">{selectedFile}</div><pre className="real-diff">{diff || "选择文件以查看真实 Git diff"}</pre></div>
        </div>
      ) : <div className="review-empty"><CheckCircle size={30} /><h2>工作区没有变更</h2></div>}
      <div className="review-actions">
        <button type="button" className="primary-button" disabled={busy || !gitState.files.length} onClick={onStageAll}>全部暂存</button>
        <button type="button" className="secondary-button" disabled={busy || !selectedFile} onClick={onStageFile}>暂存此文件</button>
        <button type="button" className="danger-link" disabled={busy || !selectedFile} onClick={onDiscard}>放弃此文件</button>
        <button type="button" className="back-to-chat" onClick={onBack}><ArrowLeft size={16} />返回对话</button>
      </div>
    </div>
  );
}

function AddProjectModal({ step, defaultParent, onClose, onStep, onComplete }) {
  const [choice, setChoice] = useState("import");
  const [importMode, setImportMode] = useState("folder");
  const [folderPath, setFolderPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [parent, setParent] = useState(defaultParent);
  const [projectName, setProjectName] = useState("rux-agent");
  const [template, setTemplate] = useState("empty");
  const [gitEnabled, setGitEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setParent(defaultParent), [defaultParent]);

  async function chooseDirectory(setter) {
    const path = await api.projects.chooseDirectory();
    if (path) setter(path);
  }

  async function submit(action) {
    setBusy(true); setError("");
    try { await onComplete(action); } catch (submitError) { setError(String(submitError.message || submitError)); } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal ${step === "choose" ? "choice-modal" : "form-modal"}`} role="dialog" aria-modal="true" aria-label="添加项目">
        {step === "choose" && <><ModalHeader title="添加项目" subtitle="导入现有代码，或从零开始创建" onClose={onClose} /><div className="choice-list"><button type="button" className={`project-choice ${choice === "import" ? "is-selected" : ""}`} onClick={() => setChoice("import")}><span className="choice-icon"><DownloadSimple size={26} /></span><span><strong>导入已有项目</strong><small>选择本地文件夹或克隆 Git 仓库</small></span><span className="radio-mark">{choice === "import" && <span />}</span></button><button type="button" className={`project-choice ${choice === "create" ? "is-selected" : ""}`} onClick={() => setChoice("create")}><span className="choice-icon"><FolderPlus size={27} /></span><span><strong>新建项目</strong><small>创建空项目或从模板开始</small></span><span className="radio-mark">{choice === "create" && <span />}</span></button></div><div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><span className="keyboard-hint">按 ↵ 继续</span><button type="button" className="primary-button" onClick={() => onStep(choice)}>继续</button></div></>}
        {step === "import" && <><ModalHeader title="导入已有项目" subtitle="选择本地文件夹，或从 Git 仓库克隆" onBack={() => onStep("choose")} onClose={onClose} /><div className="segmented-control"><button type="button" className={importMode === "folder" ? "is-active" : ""} onClick={() => setImportMode("folder")}>本地文件夹</button><button type="button" className={importMode === "git" ? "is-active" : ""} onClick={() => setImportMode("git")}>Git 仓库</button></div>{importMode === "folder" ? <div className="form-stack"><div className="form-row"><span><strong>项目文件夹</strong><small>{folderPath || "尚未选择"}</small></span><button type="button" className="secondary-button" onClick={() => chooseDirectory(setFolderPath)}>选择文件夹</button></div>{folderPath && <div className="detected-project"><Folder size={30} /><span><strong>{folderPath.split("/").pop()}</strong><small>{folderPath}</small></span><span className="import-ok"><CheckCircle size={18} />可以导入</span></div>}</div> : <div className="form-stack"><label className="field-label">Git 仓库地址<input value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder="https://github.com/org/repo.git" /></label><label className="field-label">保存位置<input value={parent} onChange={(event) => setParent(event.target.value)} /></label></div>}{error && <p className="form-error"><WarningCircle size={16} />{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onStep("choose")}>上一步</button><button type="button" className="primary-button" disabled={busy || (importMode === "folder" ? !folderPath : !gitUrl)} onClick={() => submit(importMode === "folder" ? { kind: "import", path: folderPath } : { kind: "clone", url: gitUrl, parent })}>{busy ? "处理中…" : "导入项目"}</button></div></>}
        {step === "create" && <><ModalHeader title="新建项目" subtitle="创建一个新的本地项目" onBack={() => onStep("choose")} onClose={onClose} /><div className="form-stack create-form"><label className="field-label">项目名称<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><div className="form-row"><span><strong>保存位置</strong><small>{parent}</small></span><button type="button" className="secondary-button" onClick={() => chooseDirectory(setParent)}>选择位置</button></div><fieldset className="template-fieldset"><legend>起始模板</legend><div className="template-options">{[["empty", "空项目", <Folder key="folder" size={19} />], ["react", "React", <Code key="react" size={19} />], ["node", "Node.js", <TerminalWindow key="node" size={19} />]].map(([id, title, icon]) => <button type="button" key={id} className={template === id ? "is-selected" : ""} onClick={() => setTemplate(id)}><span className="radio-mark">{template === id && <span />}</span>{icon}{title}</button>)}</div></fieldset><label className="toggle-row"><span>初始化 Git 仓库</span><input type="checkbox" checked={gitEnabled} onChange={(event) => setGitEnabled(event.target.checked)} /><span className="toggle-control" /></label><div className="path-preview">{parent}/{projectName || "新项目"}</div></div>{error && <p className="form-error"><WarningCircle size={16} />{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onStep("choose")}>上一步</button><button type="button" className="primary-button" disabled={busy || !projectName.trim()} onClick={() => submit({ kind: "create", name: projectName, parent, template, initGit: gitEnabled })}>{busy ? "创建中…" : "创建项目"}</button></div></>}
      </section>
    </div>
  );
}

function ModalHeader({ title, subtitle, onBack, onClose }) {
  return <div className="modal-header"><div className="modal-title-row">{onBack && <IconButton label="返回" onClick={onBack}><ArrowLeft size={20} /></IconButton>}<h2>{title}</h2><IconButton label="关闭" className="modal-close" onClick={onClose}><X size={20} /></IconButton></div><p>{subtitle}</p></div>;
}

function SettingsScreen({ settings, auth, models, onBack, onSave, onTest, onLogin, onLogout, onNotify }) {
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => setDraft(settings), [settings]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const draftModel = selectedCodexModel(draft, models);
  const availableEfforts = draft.provider === "codex" && draftModel
    ? draftModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
    : Object.keys(reasoningLabels).filter((effort) => effort !== "ultra");
  async function execute(action) { setBusy(true); setStatus(""); try { const message = await action(); if (message) setStatus(message); } catch (error) { setStatus(String(error.message || error)); } finally { setBusy(false); } }
  return (
    <div className="settings-shell">
      <aside className="settings-sidebar"><button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={18} />返回 Rux</button><label className="settings-search"><MagnifyingGlass size={18} /><input placeholder="搜索设置…" /></label><nav><button type="button"><GearSix size={19} />常规</button><button type="button"><Palette size={19} />外观</button><button type="button"><LockKey size={19} />权限</button><button type="button" className="is-active"><SlidersHorizontal size={19} />模型与连接</button><button type="button"><Keyboard size={19} />键盘快捷键</button><button type="button"><GitBranch size={19} />Git</button><button type="button"><Monitor size={19} />环境</button></nav></aside>
      <main className="settings-content"><h1>模型与连接</h1>
        <section className="settings-section"><h2>GPT OAuth</h2><div className="settings-group oauth-group"><div className="settings-row provider-row"><div className="provider-mark"><CircleNotch size={24} /></div><strong>Codex CLI</strong><span className={auth.connected ? "connected-badge" : "disconnected-badge"}>{auth.connected ? "已连接" : "未登录"}</span><span className="provider-email">{auth.message || "本机 ChatGPT 登录"}</span><button type="button" className="secondary-button" onClick={() => execute(async () => { await onLogin(); return "已启动设备登录"; })}>重新登录</button></div><button type="button" className="danger-link disconnect-link" onClick={() => { if (window.confirm("确认退出本机 Codex 登录？")) execute(onLogout); }}>断开连接</button></div></section>
        <section className="settings-section"><h2>连接方式</h2><div className="settings-group"><div className="settings-row provider-choice"><button type="button" className={draft.provider === "codex" ? "is-selected" : ""} onClick={() => update({ provider: "codex" })}>GPT OAuth</button><button type="button" className={draft.provider === "custom" ? "is-selected" : ""} onClick={() => update({ provider: "custom" })}>自定义服务</button></div></div></section>
        <section className="settings-section"><h2>自定义服务</h2><div className="settings-group form-settings"><label className="settings-row"><span>服务名称</span><input value={draft.serviceName} onChange={(event) => update({ serviceName: event.target.value })} /></label><label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label><label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" value={apiKey} placeholder={draft.hasApiKey ? "已安全保存" : "输入 API key"} onChange={(event) => setApiKey(event.target.value)} /><Eye size={18} /></span></label><div className="settings-row settings-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => execute(async () => (await onTest({ ...draft, apiKey })).message)}>测试连接</button><span className={status.includes("失败") || status.includes("错误") ? "error-text" : "connected"}>{status}</span><button type="button" className="primary-button" disabled={busy} onClick={() => execute(async () => { await onSave({ ...draft, apiKey }); setApiKey(""); onNotify("设置已持久化"); return "已保存"; })}>保存服务</button></div></div></section>
        <section className="settings-section">
          <h2>默认模型</h2>
          <div className="settings-group form-settings">
            <label className="settings-row">
              <span>模型</span>
              {draft.provider === "codex" ? (
                <select value={draftModel?.model || ""} onChange={(event) => { const model = models.find((item) => item.model === event.target.value); if (model) update({ model: model.model, reasoning: model.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === draft.reasoning) ? draft.reasoning : model.defaultReasoningEffort }); }}>
                  {models.map((model) => <option key={model.id} value={model.model}>{model.displayName}{model.isDefault ? "（Codex 默认）" : ""}</option>)}
                </select>
              ) : <input value={draft.model} placeholder="输入服务支持的模型 ID" onChange={(event) => update({ model: event.target.value })} />}
              <button type="button" className="secondary-button" onClick={() => { const model = models.find((item) => item.isDefault); update({ model: "", reasoning: model?.defaultReasoningEffort || "medium" }); }}><ArrowsClockwise size={16} />使用默认</button>
            </label>
            <div className="settings-row"><span>思考程度</span><div className="reasoning-control">{availableEfforts.map((value) => <button type="button" key={value} className={draft.reasoning === value ? "is-selected" : ""} onClick={() => update({ reasoning: value })}>{reasoningLabels[value] || value}</button>)}</div></div>
            <label className="settings-row toggle-setting"><span>允许会话覆盖默认设置</span><input type="checkbox" checked={draft.allowConversationOverride} onChange={(event) => update({ allowConversationOverride: event.target.checked })} /><span className="toggle-control" /></label>
            <div className="settings-row settings-actions"><span className={status.includes("失败") || status.includes("错误") ? "error-text" : "connected"}>{status}</span><button type="button" className="primary-button" disabled={busy} onClick={() => execute(async () => { await onSave(draft); onNotify("默认模型设置已保存"); return "已保存"; })}>保存默认设置</button></div>
          </div>
          <p className="settings-help">Codex 模型与推理级别来自本机 Codex App Server；API key 由 Electron 主进程使用系统安全存储加密。</p>
        </section>
      </main>
    </div>
  );
}

function App() {
  const [workspace, setWorkspace] = useState(fallbackWorkspace);
  const [settings, setSettings] = useState(fallbackSettings);
  const [auth, setAuth] = useState({ connected: false, message: "" });
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [defaultParent, setDefaultParent] = useState("");
  const [expandedProjects, setExpandedProjects] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [view, setView] = useState("project");
  const [modalStep, setModalStep] = useState(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("");
  const [modelOpen, setModelOpen] = useState(null);
  const [messages, setMessages] = useState(loadMessages);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [gitState, setGitState] = useState({ branch: "—", files: [] });
  const [selectedFile, setSelectedFile] = useState("");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [fatalError, setFatalError] = useState("");

  const activeMessages = activeThread ? messages[activeThread.id] || [] : [];
  const isStandalone = activeThread?.type === "standalone";
  const activeProject = activeThread?.type === "project" ? workspace.projects.find((project) => project.id === activeThread.projectId) : null;
  const showEnvironment = Boolean(activeProject && rightPanelOpen && !terminalOpen);
  const showToolLauncher = Boolean(activeProject && rightPanelOpen && terminalOpen && view === "project");

  useEffect(() => { localStorage.setItem("rux.messages.v1", JSON.stringify(messages)); }, [messages]);

  useEffect(() => {
    if (!api) { setFatalError("当前页面未运行在 Electron 客户端中"); return undefined; }
    let cancelled = false;
    Promise.all([api.projects.list(), api.settings.get(), api.auth.status(), api.projects.defaultParent()]).then(([nextWorkspace, nextSettings, nextAuth, parent]) => {
      if (cancelled) return;
      setWorkspace(nextWorkspace); setSettings(nextSettings); setAuth(nextAuth); setDefaultParent(parent);
      const firstProject = nextWorkspace.projects[0];
      const firstThread = firstProject?.threads[0];
      if (firstProject && firstThread) {
        setExpandedProjects([firstProject.id]);
        setActiveThread({ type: "project", projectId: firstProject.id, projectName: firstProject.name, projectPath: firstProject.path, ...firstThread });
      } else if (nextWorkspace.standaloneThreads[0]) setActiveThread({ type: "standalone", ...nextWorkspace.standaloneThreads[0] });
    }).catch((error) => setFatalError(String(error.message || error)));
    api.models.list().then(({ models: nextModels }) => {
      if (!cancelled) { setModels(nextModels); setModelsError(""); }
    }).catch((error) => {
      if (!cancelled) setModelsError(String(error.message || error));
    }).finally(() => {
      if (!cancelled) setModelsLoading(false);
    });
    const off = api.terminal.onData((data) => setTerminalOutput((current) => `${current}${data}`));
    return () => { cancelled = true; off(); };
  }, []);

  useEffect(() => {
    if (activeProject) refreshGit(activeProject.id);
    else setGitState({ branch: "—", files: [] });
  }, [activeProject?.id]);

  function notify(message) {
    setToast(message); window.clearTimeout(window.__ruxToastTimer);
    window.__ruxToastTimer = window.setTimeout(() => setToast(""), 3000);
  }

  async function reloadWorkspace(selectProject) {
    const next = await api.projects.list(); setWorkspace(next);
    if (selectProject) {
      const project = next.projects.find((item) => item.id === selectProject.id) || selectProject;
      const thread = project.threads[0];
      setExpandedProjects((current) => current.includes(project.id) ? current : [...current, project.id]);
      if (thread) setActiveThread({ type: "project", projectId: project.id, projectName: project.name, projectPath: project.path, ...thread });
    }
    return next;
  }

  async function refreshGit(projectId = activeProject?.id) {
    if (!projectId) return;
    try { const status = await api.git.status(projectId); setGitState(status); if (status.files.length && !status.files.some((file) => file.path === selectedFile)) await selectDiff(status.files[0].path, projectId); if (!status.files.length) { setSelectedFile(""); setDiff(""); } } catch (error) { setGitState({ branch: "—", files: [] }); notify(String(error.message || error)); }
  }

  async function selectDiff(path, projectId = activeProject?.id) { if (!projectId) return; setSelectedFile(path); setDiff("加载中…"); try { setDiff(await api.git.diff({ projectId, path })); } catch (error) { setDiff(String(error.message || error)); } }

  function selectProjectThread(project, thread) { setActiveThread({ type: "project", projectId: project.id, projectName: project.name, projectPath: project.path, ...thread }); setView("project"); closeTerminal(); setModelOpen(null); }
  function selectStandalone(thread) { setActiveThread({ type: "standalone", ...thread }); setView("standalone"); closeTerminal(); setModelOpen(null); }

  async function newProjectThread(project) { try { const thread = await api.projects.addThread({ projectId: project.id, title: "未命名会话" }); await reloadWorkspace(); selectProjectThread(project, thread); } catch (error) { notify(String(error.message || error)); } }
  async function newStandalone() { try { const thread = await api.projects.addStandalone({ title: "未命名会话" }); await reloadWorkspace(); selectStandalone(thread); } catch (error) { notify(String(error.message || error)); } }

  async function removeProject(project) {
    if (!window.confirm(`从 Rux 中移除“${project.name}”？\n\n仅解除侧栏关联，不会删除磁盘中的项目文件。`)) return;
    try {
      const { workspace: nextWorkspace } = await api.projects.remove(project.id);
      setWorkspace(nextWorkspace);
      setExpandedProjects((current) => current.filter((id) => id !== project.id));
      if (activeThread?.type === "project" && activeThread.projectId === project.id) {
        await closeTerminal();
        const nextProject = nextWorkspace.projects[0];
        const nextThread = nextProject?.threads[0];
        if (nextProject && nextThread) selectProjectThread(nextProject, nextThread);
        else if (nextWorkspace.standaloneThreads[0]) selectStandalone(nextWorkspace.standaloneThreads[0]);
      }
      notify(`已移除 ${project.name}，本地文件未删除`);
    } catch (error) { notify(String(error.message || error)); }
  }

  async function completeProjectAction(action) {
    let project;
    if (action.kind === "create") project = await api.projects.create(action);
    else if (action.kind === "clone") project = await api.projects.clone(action);
    else project = await api.projects.import(action);
    await reloadWorkspace(project); setModalStep(null); notify(action.kind === "create" ? "项目已创建并加入侧栏" : "项目已导入并加入侧栏");
  }

  async function sendMessage() {
    const prompt = composerValue.trim(); if (!prompt || !activeThread || sending) return;
    const userMessage = { id: crypto.randomUUID(), role: "user", text: prompt };
    setMessages((current) => ({ ...current, [activeThread.id]: [...(current[activeThread.id] || []), userMessage] }));
    setComposerValue(""); setSending(true);
    try {
      const result = await api.agent.send({ projectId: activeProject?.id, prompt, model: settings.model, reasoning: settings.reasoning, threadId: activeThread.codexThreadId });
      const assistantMessage = { id: crypto.randomUUID(), role: "assistant", text: result.text };
      setMessages((current) => ({ ...current, [activeThread.id]: [...(current[activeThread.id] || []), assistantMessage] }));
      if (result.threadId && result.threadId !== activeThread.codexThreadId) {
        const updated = await api.threads.update({ type: activeThread.type, projectId: activeThread.projectId, threadId: activeThread.id, codexThreadId: result.threadId, title: activeThread.title.startsWith("未命名") || activeThread.title === "项目会话" ? prompt.slice(0, 28) : undefined });
        setActiveThread((current) => ({ ...current, ...updated })); await reloadWorkspace();
      }
      if (activeProject) await refreshGit(activeProject.id);
    } catch (error) {
      setMessages((current) => ({ ...current, [activeThread.id]: [...(current[activeThread.id] || []), { id: crypto.randomUUID(), role: "assistant", text: String(error.message || error), error: true }] }));
    } finally { setSending(false); }
  }

  async function toggleTerminal() {
    if (!activeProject) return;
    if (terminalOpen) await closeTerminal();
    else { setTerminalOutput("正在启动终端…\n"); setTerminalOpen(true); try { await api.terminal.start(activeProject.id); } catch (error) { setTerminalOutput(`${error.message || error}\n`); } }
  }
  async function closeTerminal() { if (terminalOpen && api) await api.terminal.stop().catch(() => {}); setTerminalOpen(false); }
  async function runTerminalCommand() { const command = terminalCommand.trim(); if (!command) return; setTerminalOutput((current) => `${current}$ ${command}\n`); setTerminalCommand(""); try { await api.terminal.write(command); window.setTimeout(() => refreshGit(), 500); } catch (error) { setTerminalOutput((current) => `${current}${error.message || error}\n`); } }

  async function stage(paths) { if (!activeProject || !paths.length) return; setBusy(true); try { const status = await api.git.stage({ projectId: activeProject.id, paths }); setGitState(status); notify("已真实暂存所选文件"); if (!status.files.length) setView("project"); } catch (error) { notify(String(error.message || error)); } finally { setBusy(false); } }
  async function discardSelected() { if (!activeProject || !selectedFile || !window.confirm(`确认放弃 ${selectedFile} 的未暂存修改？此操作不可撤销。`)) return; setBusy(true); try { const status = await api.git.discard({ projectId: activeProject.id, path: selectedFile }); setGitState(status); notify("文件修改已恢复"); if (status.files.length) await selectDiff(status.files[0].path); else setView("project"); } catch (error) { notify(String(error.message || error)); } finally { setBusy(false); } }
  async function openReview() { if (activeProject) await refreshGit(activeProject.id); setView("review"); }

  async function saveSettings(input) { const saved = await api.settings.save(input); setSettings(saved); return saved; }
  async function testSettings(input) { return await api.settings.test(input); }

  async function selectModel(model) {
    try {
      const supported = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
      const reasoning = supported.includes(settings.reasoning) ? settings.reasoning : model.defaultReasoningEffort;
      await saveSettings({ model: model.model, reasoning });
      setModelOpen(null);
      notify(`已切换到 ${model.displayName}`);
    } catch (error) { notify(String(error.message || error)); }
  }

  async function selectReasoning(reasoning) {
    try {
      await saveSettings({ reasoning });
      setModelOpen(null);
      notify(`思考程度已切换为${reasoningLabels[reasoning] || reasoning}`);
    } catch (error) { notify(String(error.message || error)); }
  }

  if (fatalError) return <div className="fatal-screen"><WarningCircle size={32} /><h1>Rux 无法启动</h1><p>{fatalError}</p></div>;
  if (!activeThread) return <div className="fatal-screen"><CircleNotch size={30} className="spin" /><p>正在加载工作区…</p></div>;
  if (view === "settings") return <div className="app-frame"><SettingsScreen settings={settings} auth={auth} models={models} onBack={() => setView(isStandalone ? "standalone" : "project")} onSave={saveSettings} onTest={testSettings} onLogin={async () => { await api.auth.login(); setTimeout(async () => setAuth(await api.auth.status()), 1500); }} onLogout={async () => { await api.auth.logout(); setAuth(await api.auth.status()); return "已退出"; }} onNotify={notify} />{toast && <div className="toast"><CheckCircle size={18} />{toast}</div>}</div>;

  const composerProps = { settings, auth, models, modelsLoading, modelsError, modelOpen, onToggleModel: (menu) => setModelOpen((open) => open === menu ? null : menu), onSelectModel: selectModel, onSelectReasoning: selectReasoning, onAssociateProject: () => { const project = workspace.projects[0]; const thread = project?.threads[0]; if (project && thread) selectProjectThread(project, thread); }, value: composerValue, onChange: setComposerValue, onSend: sendMessage, sending };
  return (
    <div className="app-frame">
      <Sidebar workspace={workspace} expandedProjects={expandedProjects} activeThread={activeThread} onToggleProject={(projectId) => setExpandedProjects((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])} onSelectProjectThread={selectProjectThread} onSelectStandalone={selectStandalone} onAddProject={() => setModalStep("choose")} onRemoveProject={removeProject} onNewProjectThread={newProjectThread} onNewStandalone={newStandalone} onOpenSettings={() => setView("settings")} />
      <main className="app-stage">
        <TopBar activeThread={activeThread} rightPanelOpen={rightPanelOpen} onToggleRightPanel={() => setRightPanelOpen((open) => !open)} onOpenSettings={() => setView("settings")} onOpenPath={() => activeProject && api.system.openPath(activeProject.id).catch((error) => notify(String(error.message || error)))} />
        <div className={`stage-body ${terminalOpen ? "terminal-is-open" : ""}`}><div className="work-pane"><div className="main-content">{view === "review" ? <ReviewScreen gitState={gitState} selectedFile={selectedFile} diff={diff} onSelectFile={selectDiff} onBack={() => setView("project")} onStageAll={() => stage(gitState.files.map((file) => file.path))} onStageFile={() => stage([selectedFile])} onDiscard={discardSelected} busy={busy} /> : <ConversationScreen standalone={isStandalone} activeThread={activeThread} messages={activeMessages} sending={sending} composerProps={composerProps} gitState={gitState} onReview={openReview} terminalOpen={terminalOpen} onToggleTerminal={toggleTerminal} />}</div>{showEnvironment && <EnvironmentPanel gitState={gitState} onReview={openReview} />}{showToolLauncher && <ToolLauncher />}{isStandalone && rightPanelOpen && <UtilityPanel />}</div>{terminalOpen && view === "project" && <TerminalPanel output={terminalOutput} command={terminalCommand} onCommandChange={setTerminalCommand} onRun={runTerminalCommand} onClose={closeTerminal} projectName={activeProject?.name || "终端"} />}</div>
      </main>
      {modalStep && <AddProjectModal step={modalStep} defaultParent={defaultParent} onClose={() => setModalStep(null)} onStep={setModalStep} onComplete={completeProjectAction} />}
      {toast && <div className="toast"><CheckCircle size={18} />{toast}</div>}
    </div>
  );
}

export default App;
