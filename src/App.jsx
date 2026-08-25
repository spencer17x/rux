import { useEffect, useMemo, useRef, useState } from "react";
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
  HandPalm,
  Keyboard,
  LockKey,
  MagnifyingGlass,
  Microphone,
  Monitor,
  OpenAiLogo,
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
  standaloneThreads: [],
};

const fallbackSettings = {
  provider: "codex",
  serviceName: "OpenAI Compatible",
  baseUrl: "https://api.openai.com/v1",
  hasApiKey: false,
  model: "",
  reasoning: "high",
  sandboxMode: "workspace-write",
  uiFontSize: 14,
  allowConversationOverride: true,
};

const reasoningLabels = { none: "无", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大", ultra: "Ultra" };
const permissionOptions = [
  { value: "read-only", shortLabel: "请求批准", title: "请求批准", description: "编辑外部文件和使用互联网时始终询问", Icon: HandPalm },
  { value: "workspace-write", shortLabel: "帮我批准", title: "帮我批准", description: "仅对检测到的风险操作请求批准", Icon: ShieldCheck },
  { value: "danger-full-access", shortLabel: "完全访问", title: "完全访问权限", description: "可不受限制地访问互联网和你电脑上的任何文件", Icon: WarningCircle },
];
const sandboxLabels = Object.fromEntries(permissionOptions.map((option) => [option.value, option.shortLabel]));

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
  auth,
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const query = searchQuery.trim().toLocaleLowerCase();
  const standaloneThreads = workspace.standaloneThreads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query));
  const projects = workspace.projects.map((project) => ({ ...project, threads: project.threads.filter((thread) => !query || thread.title.toLocaleLowerCase().includes(query)) })).filter((project) => !query || project.name.toLocaleLowerCase().includes(query) || project.threads.length);
  const email = auth.account?.email || "";
  const accountName = email ? email.split("@")[0] : "Rux User";
  const initial = accountName.slice(0, 1).toUpperCase();
  return (
    <aside className="sidebar" aria-label="Rux 导航">
      <div className="sidebar-brand-row">
        <strong className="brand">Rux</strong>
        <div className="sidebar-actions">
          <IconButton label="搜索" active={searchOpen} onClick={() => { setSearchOpen((open) => !open); setNotificationsOpen(false); setProfileOpen(false); }}><MagnifyingGlass size={18} /></IconButton>
          <IconButton label="通知" active={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setSearchOpen(false); setProfileOpen(false); }}><Bell size={18} /></IconButton>
        </div>
      </div>
      {searchOpen && <label className="sidebar-search"><MagnifyingGlass size={16} /><input aria-label="搜索项目和会话" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索项目和会话" /><IconButton label="清除搜索" onClick={() => setSearchQuery("")}><X size={14} /></IconButton></label>}
      {notificationsOpen && <div className="sidebar-popover notification-popover"><strong>通知</strong><span>当前没有新通知</span></div>}
      <nav className="sidebar-scroll">
        <section className="sidebar-section">
          <div className="section-heading">
            <span>独立会话</span>
            <IconButton label="新建独立会话" onClick={onNewStandalone}><Plus size={17} /></IconButton>
          </div>
          <div className="sidebar-list">
            {standaloneThreads.map((thread) => (
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
            {projects.map((project) => {
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
      {profileOpen && <div className="sidebar-popover profile-popover"><strong>{accountName}</strong><small>{email || (auth.connected ? "Codex 已连接" : "Codex 未登录")}</small><button type="button" onClick={onOpenSettings}><GearSix size={16} />设置</button></div>}
      <button type="button" className="profile-row" onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); setSearchOpen(false); }} aria-expanded={profileOpen}>
        <span className="avatar avatar-small">{initial}</span><span>{accountName}</span><CaretDown size={15} />
      </button>
    </aside>
  );
}

function TopBar({ activeThread, rightPanelOpen, onToggleRightPanel, onOpenSettings, onOpenPath, onCopyPath, onShare, onRename, onRemoveThread }) {
  const isProject = activeThread?.type === "project";
  const [moreOpen, setMoreOpen] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-title">
        {isProject ? <Folder size={19} /> : <ChatCircle size={19} />}
        {isProject && <span className="muted-title">{activeThread.projectName}</span>}
        {isProject && <span className="title-separator">/</span>}
        <strong>{activeThread?.title || "Rux"}</strong>
        {!isProject && <span className="standalone-badge">独立会话</span>}
        <span className="toolbar-menu-wrap"><IconButton label="更多" active={moreOpen} onClick={() => { setMoreOpen((open) => !open); setPathOpen(false); }}><DotsThree size={20} /></IconButton>{moreOpen && <span className="toolbar-popover"><button type="button" onClick={() => { setMoreOpen(false); onRename(); }}>重命名会话</button><button type="button" className="danger-text" onClick={() => { setMoreOpen(false); onRemoveThread(); }}>移除会话</button></span>}</span>
      </div>
      <div className="topbar-actions">
        <IconButton label="复制会话内容" onClick={onShare}><ShareNetwork size={18} /></IconButton>
        {isProject && <span className="toolbar-menu-wrap"><button type="button" className="toolbar-button" aria-expanded={pathOpen} onClick={() => { setPathOpen((open) => !open); setMoreOpen(false); }}>打开位置<CaretDown size={14} /></button>{pathOpen && <span className="toolbar-popover path-popover"><button type="button" onClick={() => { setPathOpen(false); onOpenPath(); }}>在 Finder 中打开</button><button type="button" onClick={() => { setPathOpen(false); onCopyPath(); }}>复制项目路径</button></span>}</span>}
        <IconButton label="切换侧边面板" active={rightPanelOpen} onClick={onToggleRightPanel}><SidebarSimple size={19} /></IconButton>
        <IconButton label="设置" onClick={onOpenSettings}><GearSix size={18} /></IconButton>
      </div>
    </header>
  );
}

function EnvironmentPanel({ gitState, branches, branchOpen, onToggleBranch, onSwitchBranch, onRefresh, onCommitPush, onReview }) {
  const plus = gitState.files.reduce((total, file) => total + file.plus, 0);
  const minus = gitState.files.reduce((total, file) => total + file.minus, 0);
  return (
    <aside className="environment-panel">
      <div className="panel-heading"><span>环境信息</span><IconButton label="刷新环境信息" onClick={onRefresh}><ArrowsClockwise size={16} /></IconButton></div>
      <button type="button" className="environment-row" onClick={onReview}>
        <FileText size={18} /><strong>变更</strong>
        <span className="change-count"><b>+{plus}</b> <em>−{minus}</em></span>
      </button>
      <div className="environment-row"><Monitor size={18} /><strong>本地</strong></div>
      <div className="environment-menu-wrap"><button type="button" className="environment-row" aria-expanded={branchOpen} onClick={onToggleBranch}><GitBranch size={18} /><span>{gitState.branch || "—"}</span><CaretDown size={15} className="row-end" /></button>{branchOpen && <div className="branch-popover">{branches.length ? branches.map((branch) => <button type="button" key={branch} className={branch === gitState.branch ? "is-selected" : ""} onClick={() => onSwitchBranch(branch)}>{branch}{branch === gitState.branch && <Check size={14} />}</button>) : <span>没有其他本地分支</span>}</div>}</div>
      <button type="button" className="environment-row" onClick={onCommitPush}><ArrowUp size={18} /><span>提交或推送</span></button>
      <button type="button" className="environment-row" onClick={onReview}><GitBranch size={18} /><strong>比较分支</strong><ArrowSquareOut size={15} className="row-end" /></button>
    </aside>
  );
}

function UtilityPanel({ webSearch, onToggleWebSearch, onAddFiles }) {
  return (
    <aside className="utility-panel">
      <button type="button" className={webSearch ? "is-active" : ""} onClick={onToggleWebSearch}><Globe size={19} /><span>{webSearch ? "已启用网页搜索" : "搜索网页"}</span>{webSearch && <Check size={15} />}</button>
      <button type="button" onClick={onAddFiles}><Paperclip size={19} /><span>添加文件</span></button>
    </aside>
  );
}

function ToolLauncher({ onReview, onOpenPath, onOpenRemote, onNewStandalone }) {
  return (
    <aside className="tool-launcher" aria-label="工作区工具">
      <button type="button" onClick={onReview}><FileText size={19} /><span>审查</span><kbd>⌃⇧G</kbd></button>
      <button type="button" className="is-active"><TerminalWindow size={19} /><span>终端</span><kbd>⌃`</kbd></button>
      <button type="button" onClick={onOpenRemote}><Globe size={19} /><span>浏览器</span><kbd>⌘T</kbd></button>
      <button type="button" onClick={onOpenPath}><FolderOpen size={19} /><span>文件</span><kbd>⌘P</kbd></button>
      <button type="button" onClick={onNewStandalone}><ChatCircle size={19} /><span>侧边聊天</span><kbd>⌥⌘S</kbd></button>
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

function PermissionPopover({ selectedValue, onSelect, onLearnMore }) {
  return (
    <span className="scope-popover permission-popover" role="dialog" aria-label="操作批准方式">
      <span className="permission-popover-heading"><strong>应如何批准 Rux 操作？</strong><button type="button" onClick={onLearnMore}>了解更多</button></span>
      {permissionOptions.map(({ value, title, description, Icon }) => <button type="button" key={value} className={`permission-option ${selectedValue === value ? "is-selected" : ""}`} onClick={() => onSelect(value)}><Icon size={20} /><span><strong>{title}</strong><small>{description}</small></span>{selectedValue === value && <Check size={18} weight="bold" />}</button>)}
    </span>
  );
}

function Composer({ standalone, settings, auth, models, modelsLoading, modelsError, modelOpen, sandboxOpen, attachments, listening, onToggleModel, onSelectModel, onSelectReasoning, onToggleSandbox, onSelectSandbox, onPermissionInfo, onAddFiles, onRemoveAttachment, onVoice, onAssociateProject, value, onChange, onSend, sending }) {
  return (
    <form className="composer-wrap" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      {modelOpen && <ModelPopover mode={modelOpen} settings={settings} auth={auth} models={models} loading={modelsLoading} error={modelsError} onSelectModel={onSelectModel} onSelectReasoning={onSelectReasoning} />}
      <div className="composer">
        {attachments.length > 0 && <div className="attachment-list">{attachments.map((path) => <span key={path}><Paperclip size={13} />{path.split("/").pop()}<button type="button" aria-label={`移除附件 ${path.split("/").pop()}`} onClick={() => onRemoveAttachment(path)}><X size={12} /></button></span>)}</div>}
        <textarea aria-label="消息" placeholder="向 Rux 发送消息" rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={sending} />
        <div className="composer-controls">
          <div className="composer-left">
            <IconButton label="添加文件" onClick={onAddFiles}><Plus size={20} /></IconButton>
            {standalone ? (
              <><span className="scope-menu-wrap"><button type="button" className="scope-button neutral" aria-expanded={sandboxOpen} onClick={onToggleSandbox}><FolderOpen size={17} />{sandboxLabels[settings.sandboxMode] || "帮我批准"}<CaretDown size={13} /></button>{sandboxOpen && <PermissionPopover selectedValue={settings.sandboxMode} onSelect={onSelectSandbox} onLearnMore={onPermissionInfo} />}</span><button type="button" className="text-action" onClick={onAssociateProject}>关联到项目</button></>
            ) : (
              <span className="scope-menu-wrap"><button type="button" className="scope-button" aria-expanded={sandboxOpen} onClick={onToggleSandbox}><ShieldCheck size={17} />{sandboxLabels[settings.sandboxMode] || "帮我批准"}<CaretDown size={13} /></button>{sandboxOpen && <PermissionPopover selectedValue={settings.sandboxMode} onSelect={onSelectSandbox} onLearnMore={onPermissionInfo} />}</span>
            )}
          </div>
          <div className="composer-right">
            <button type="button" className={`composer-menu ${modelOpen === "models" ? "is-active" : ""}`} aria-expanded={modelOpen === "models"} onClick={() => onToggleModel("models")}>{modelDisplayName(settings, models)}<CaretDown size={13} /></button>
            <button type="button" className={`composer-menu ${modelOpen === "reasoning" ? "is-active" : ""}`} aria-expanded={modelOpen === "reasoning"} onClick={() => onToggleModel("reasoning")}>{reasoningLabels[settings.reasoning] || settings.reasoning}<CaretDown size={13} /></button>
            <IconButton label={listening ? "停止语音输入" : "语音输入"} active={listening} className={listening ? "voice-listening" : ""} onClick={onVoice}><Microphone size={19} /></IconButton>
            <button type="submit" className="send-button" aria-label="发送" disabled={sending || !value.trim()}>{sending ? <CircleNotch size={20} className="spin" /> : <ArrowUp size={20} weight="bold" />}</button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Conversation({ messages, sending, emptyTitle }) {
  const endRef = useRef(null);
  const hasMounted = useRef(false);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: hasMounted.current ? "smooth" : "auto" });
    hasMounted.current = true;
  }, [messages.length, sending]);
  if (!messages.length && !sending) {
    return <div className="conversation-empty"><ChatCircle size={32} /><h2>{emptyTitle}</h2><p>输入任务后，Rux 将调用真实的本机 Codex 会话。</p></div>;
  }
  return (
    <div className="conversation-scroll">
      {messages.map((message) => (
        <div className={`message ${message.role === "user" ? "user-message" : "agent-message"}`} key={message.id}>
          {message.role === "user" ? <><div className="message-bubble">{message.text}</div><span className="avatar">S</span></> : <><span className="avatar avatar-dark">R</span><div className="agent-copy"><p className={message.error ? "error-text" : ""}>{message.text}</p></div></>}
        </div>
      ))}
      {sending && <div className="message agent-message"><span className="avatar avatar-dark">R</span><div className="agent-copy agent-loading"><CircleNotch size={18} className="spin" />Codex 正在处理任务…</div></div>}
      <div ref={endRef} aria-hidden="true" />
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
  const [createThread, setCreateThread] = useState(true);
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
        {step === "import" && <><ModalHeader title="导入已有项目" subtitle="选择本地文件夹，或从 Git 仓库克隆" onBack={() => onStep("choose")} onClose={onClose} /><div className="segmented-control"><button type="button" className={importMode === "folder" ? "is-active" : ""} onClick={() => setImportMode("folder")}>本地文件夹</button><button type="button" className={importMode === "git" ? "is-active" : ""} onClick={() => setImportMode("git")}>Git 仓库</button></div>{importMode === "folder" ? <div className="form-stack"><div className="form-row"><span><strong>项目文件夹</strong><small>{folderPath || "尚未选择"}</small></span><button type="button" className="secondary-button" onClick={() => chooseDirectory(setFolderPath)}>选择文件夹</button></div>{folderPath && <div className="detected-project"><Folder size={30} /><span><strong>{folderPath.split("/").pop()}</strong><small>{folderPath}</small></span><span className="import-ok"><CheckCircle size={18} />可以导入</span></div>}</div> : <div className="form-stack"><label className="field-label">Git 仓库地址<input value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder="https://github.com/org/repo.git" /></label><label className="field-label">保存位置<input value={parent} onChange={(event) => setParent(event.target.value)} /></label></div>}<label className="checkbox-row"><input type="checkbox" checked={createThread} onChange={(event) => setCreateThread(event.target.checked)} />导入后创建首个项目会话</label>{error && <p className="form-error"><WarningCircle size={16} />{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onStep("choose")}>上一步</button><button type="button" className="primary-button" disabled={busy || (importMode === "folder" ? !folderPath : !gitUrl)} onClick={() => submit(importMode === "folder" ? { kind: "import", path: folderPath, createThread } : { kind: "clone", url: gitUrl, parent, createThread })}>{busy ? "处理中…" : "导入项目"}</button></div></>}
        {step === "create" && <><ModalHeader title="新建项目" subtitle="创建一个新的本地项目" onBack={() => onStep("choose")} onClose={onClose} /><div className="form-stack create-form"><label className="field-label">项目名称<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><div className="form-row"><span><strong>保存位置</strong><small>{parent}</small></span><button type="button" className="secondary-button" onClick={() => chooseDirectory(setParent)}>选择位置</button></div><fieldset className="template-fieldset"><legend>起始模板</legend><div className="template-options">{[["empty", "空项目", <Folder key="folder" size={19} />], ["react", "React", <Code key="react" size={19} />], ["node", "Node.js", <TerminalWindow key="node" size={19} />]].map(([id, title, icon]) => <button type="button" key={id} className={template === id ? "is-selected" : ""} onClick={() => setTemplate(id)}><span className="radio-mark">{template === id && <span />}</span>{icon}{title}</button>)}</div></fieldset><label className="toggle-row"><span>初始化 Git 仓库</span><input type="checkbox" checked={gitEnabled} onChange={(event) => setGitEnabled(event.target.checked)} /><span className="toggle-control" /></label><label className="checkbox-row"><input type="checkbox" checked={createThread} onChange={(event) => setCreateThread(event.target.checked)} />创建后新建项目会话</label><div className="path-preview">{parent}/{projectName || "新项目"}</div></div>{error && <p className="form-error"><WarningCircle size={16} />{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onStep("choose")}>上一步</button><button type="button" className="primary-button" disabled={busy || !projectName.trim()} onClick={() => submit({ kind: "create", name: projectName, parent, template, initGit: gitEnabled, createThread })}>{busy ? "创建中…" : "创建项目"}</button></div></>}
      </section>
    </div>
  );
}

function ModalHeader({ title, subtitle, onBack, onClose }) {
  return <div className="modal-header"><div className="modal-title-row">{onBack && <IconButton label="返回" onClick={onBack}><ArrowLeft size={20} /></IconButton>}<h2>{title}</h2><IconButton label="关闭" className="modal-close" onClick={onClose}><X size={20} /></IconButton></div><p>{subtitle}</p></div>;
}

function SettingsScreen({ settings, auth, models, systemInfo, projectCount, activeProject, gitState, onBack, onSave, onTest, onLogin, onLogout, onNotify }) {
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [section, setSection] = useState("models");
  const [query, setQuery] = useState("");
  useEffect(() => setDraft(settings), [settings]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const draftModel = selectedCodexModel(draft, models);
  const availableEfforts = draft.provider === "codex" && draftModel ? draftModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort) : Object.keys(reasoningLabels).filter((effort) => effort !== "ultra");
  const sections = [
    ["general", "常规", GearSix], ["appearance", "外观", Palette], ["permissions", "权限", LockKey], ["models", "模型与连接", SlidersHorizontal], ["shortcuts", "键盘快捷键", Keyboard], ["git", "Git", GitBranch], ["environment", "环境", Monitor],
  ];
  const visibleSections = sections.filter(([, label]) => !query || label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const title = sections.find(([id]) => id === section)?.[1] || "设置";
  async function execute(action) { setBusy(true); setStatus(""); try { const message = await action(); if (message) setStatus(message); } catch (error) { setStatus(String(error.message || error)); } finally { setBusy(false); } }
  const saveDraft = async (message) => { await onSave(draft); onNotify(message); return "已保存"; };
  return (
    <div className="settings-shell">
      <aside className="settings-sidebar"><button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={18} />返回 Rux</button><label className="settings-search"><MagnifyingGlass size={18} /><input aria-label="搜索设置" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置…" /></label><nav>{visibleSections.map(([id, label, Icon]) => <button type="button" key={id} className={section === id ? "is-active" : ""} onClick={() => setSection(id)}><Icon size={19} />{label}</button>)}</nav></aside>
      <main className="settings-content"><h1>{title}</h1>
        {section === "general" && <><section className="settings-section"><h2>账户</h2><div className="settings-group form-settings"><div className="settings-row"><span>登录账户</span><strong>{auth.account?.email || (auth.connected ? "Codex 已连接" : "未登录")}</strong></div><div className="settings-row"><span>套餐</span><strong>{auth.account?.planType || "—"}</strong></div></div></section><section className="settings-section"><h2>工作区</h2><div className="settings-group form-settings"><div className="settings-row"><span>已添加项目</span><strong>{projectCount}</strong></div><div className="settings-row"><span>当前项目</span><strong>{activeProject?.name || "无"}</strong></div></div></section></>}
        {section === "appearance" && <section className="settings-section"><h2>外观</h2><div className="settings-group form-settings"><div className="settings-row"><span>界面主题</span><strong>跟随系统 · {window.matchMedia("(prefers-color-scheme: dark)").matches ? "深色" : "浅色"}</strong></div><div className="settings-row"><span>界面语言</span><strong>简体中文</strong></div><label className="settings-row"><span>UI 字号</span><span className="font-size-control"><input type="number" min="12" max="16" value={draft.uiFontSize || 14} onChange={(event) => { const uiFontSize = Number(event.target.value); update({ uiFontSize }); document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`); }} /><em>px</em></span></label><div className="settings-row settings-actions"><button type="button" className="primary-button" onClick={() => execute(() => saveDraft("外观设置已保存"))}>保存外观</button></div></div><p className="settings-help">默认使用与 Codex Desktop 一致的 14px UI 字号。</p></section>}
        {section === "permissions" && <section className="settings-section"><h2>默认权限</h2><div className="settings-group form-settings"><div className="settings-row"><span>Codex 沙盒</span><div className="reasoning-control">{Object.entries(sandboxLabels).map(([value, label]) => <button type="button" key={value} className={draft.sandboxMode === value ? "is-selected" : ""} onClick={() => update({ sandboxMode: value })}>{label}</button>)}</div></div><div className="settings-row settings-actions"><button type="button" className="primary-button" onClick={() => execute(() => saveDraft("默认权限已保存"))}>保存权限</button></div></div></section>}
        {section === "models" && draft.provider !== "custom" && <section className="settings-section"><h2>自定义服务</h2><div className="settings-group form-settings"><label className="settings-row"><span>服务名称</span><input value={draft.serviceName} onChange={(event) => update({ serviceName: event.target.value })} /></label><label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label><label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" value={apiKey} placeholder={draft.hasApiKey ? "已安全保存" : "输入 API key"} onChange={(event) => setApiKey(event.target.value)} /><Eye size={18} /></span></label><div className="settings-row settings-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => execute(async () => (await onTest({ ...draft, provider: "custom", apiKey })).message)}>测试连接</button><button type="button" className="primary-button" disabled={busy} onClick={() => execute(async () => { await onSave({ ...draft, provider: "custom", apiKey }); setApiKey(""); onNotify("自定义服务已保存并启用"); return "已保存"; })}>保存服务</button></div></div></section>}
        {section === "models" && <><section className="settings-section"><h2>GPT OAuth</h2><div className="settings-group oauth-group"><div className="settings-row provider-row"><div className="provider-mark"><OpenAiLogo size={27} /></div><strong>Codex CLI</strong><span className={auth.connected ? "connected-badge" : "disconnected-badge"}>{auth.connected ? "已连接" : "未登录"}</span><span className="provider-email">{auth.account?.email || (auth.connected ? "使用 ChatGPT 账户登录" : auth.message || "未检测到本机 ChatGPT 登录")}</span><button type="button" className="secondary-button" onClick={() => execute(async () => { await onLogin(); return "已启动设备登录"; })}>{auth.connected ? "重新登录" : "登录"}</button></div>{auth.connected && <button type="button" className="danger-link disconnect-link" onClick={() => { if (window.confirm("确认退出本机 Codex 登录？")) execute(onLogout); }}>断开连接</button>}</div></section><section className="settings-section"><h2>连接方式</h2><div className="settings-group"><div className="settings-row provider-choice"><button type="button" className={draft.provider === "codex" ? "is-selected" : ""} onClick={() => update({ provider: "codex" })}>GPT OAuth</button><button type="button" className={draft.provider === "custom" ? "is-selected" : ""} onClick={() => update({ provider: "custom" })}>自定义服务</button></div></div></section>{draft.provider === "custom" && <section className="settings-section"><h2>自定义服务</h2><div className="settings-group form-settings"><label className="settings-row"><span>服务名称</span><input value={draft.serviceName} onChange={(event) => update({ serviceName: event.target.value })} /></label><label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label><label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" value={apiKey} placeholder={draft.hasApiKey ? "已安全保存" : "输入 API key"} onChange={(event) => setApiKey(event.target.value)} /><Eye size={18} /></span></label><div className="settings-row settings-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => execute(async () => (await onTest({ ...draft, apiKey })).message)}>测试连接</button><button type="button" className="primary-button" disabled={busy} onClick={() => execute(async () => { await onSave({ ...draft, apiKey }); setApiKey(""); onNotify("服务设置已保存"); return "已保存"; })}>保存服务</button></div></div></section>}<section className="settings-section"><h2>默认模型</h2><div className="settings-group form-settings"><label className="settings-row"><span>模型</span>{draft.provider === "codex" ? <select value={draftModel?.model || ""} onChange={(event) => { const model = models.find((item) => item.model === event.target.value); if (model) update({ model: model.model, reasoning: model.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === draft.reasoning) ? draft.reasoning : model.defaultReasoningEffort }); }}>{models.map((model) => <option key={model.id} value={model.model}>{model.displayName}{model.isDefault ? "（Codex 默认）" : ""}</option>)}</select> : <input value={draft.model} onChange={(event) => update({ model: event.target.value })} placeholder="输入模型 ID" />}<button type="button" className="secondary-button" onClick={() => { const model = models.find((item) => item.isDefault); update({ model: "", reasoning: model?.defaultReasoningEffort || "medium" }); }}><ArrowsClockwise size={16} />使用默认</button></label><div className="settings-row"><span>思考程度</span><div className="reasoning-control">{availableEfforts.map((value) => <button type="button" key={value} className={draft.reasoning === value ? "is-selected" : ""} onClick={() => update({ reasoning: value })}>{reasoningLabels[value] || value}</button>)}</div></div><label className="settings-row toggle-setting"><span>允许会话覆盖默认设置</span><input type="checkbox" checked={draft.allowConversationOverride} onChange={(event) => update({ allowConversationOverride: event.target.checked })} /><span className="toggle-control" /></label><div className="settings-row settings-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => execute(() => saveDraft("默认模型设置已保存"))}>保存默认设置</button></div></div><p className="settings-help">模型与推理级别来自本机 Codex App Server。</p></section></>}
        {section === "shortcuts" && <section className="settings-section"><h2>键盘快捷键</h2><div className="settings-group shortcut-list">{[["打开设置", "⌘,"], ["新建独立会话", "⌘N"], ["打开终端", "⌃`"], ["审查变更", "⌃⇧G"]].map(([label, key]) => <div className="settings-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div></section>}
        {section === "git" && <section className="settings-section"><h2>当前仓库</h2><div className="settings-group form-settings"><div className="settings-row"><span>项目</span><strong>{activeProject?.name || "未选择项目"}</strong></div><div className="settings-row"><span>路径</span><strong>{activeProject?.path || "—"}</strong></div><div className="settings-row"><span>分支</span><strong>{gitState.branch}</strong></div><div className="settings-row"><span>变更文件</span><strong>{gitState.files.length}</strong></div></div></section>}
        {section === "environment" && <section className="settings-section"><h2>运行环境</h2><div className="settings-group form-settings">{[["Rux", systemInfo.appVersion], ["Codex", systemInfo.codexVersion], ["Electron", systemInfo.electronVersion], ["Chromium", systemInfo.chromeVersion], ["平台", `${systemInfo.platform || "—"} ${systemInfo.arch || ""}`]].map(([label, value]) => <div className="settings-row" key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}</div></section>}
        {status && <p className={status.includes("失败") || status.includes("错误") ? "settings-status error-text" : "settings-status connected"}>{status}</p>}
      </main>
    </div>
  );
}

function App() {
  const [workspace, setWorkspace] = useState(fallbackWorkspace);
  const [settings, setSettings] = useState(fallbackSettings);
  const [auth, setAuth] = useState({ connected: false, message: "", account: null });
  const [models, setModels] = useState([]);
  const [systemInfo, setSystemInfo] = useState({});
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
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [webSearch, setWebSearch] = useState(false);
  const [listening, setListening] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchOpen, setBranchOpen] = useState(false);
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
  useEffect(() => { document.documentElement.style.setProperty("--ui-font-size", `${settings.uiFontSize || 14}px`); }, [settings.uiFontSize]);

  useEffect(() => {
    if (!api) { setFatalError("当前页面未运行在 Electron 客户端中"); return undefined; }
    let cancelled = false;
    Promise.all([api.projects.list(), api.settings.get(), api.auth.status(), api.projects.defaultParent()]).then(async ([nextWorkspace, nextSettings, nextAuth, parent]) => {
      if (cancelled) return;
      setWorkspace(nextWorkspace); setSettings(nextSettings); setAuth(nextAuth); setDefaultParent(parent);
      const firstProject = nextWorkspace.projects[0];
      const firstThread = firstProject?.threads[0];
      if (firstProject && firstThread) {
        setExpandedProjects([firstProject.id]);
        setActiveThread({ type: "project", projectId: firstProject.id, projectName: firstProject.name, projectPath: firstProject.path, ...firstThread });
      } else if (nextWorkspace.standaloneThreads[0]) setActiveThread({ type: "standalone", ...nextWorkspace.standaloneThreads[0] });
      else {
        const thread = await api.projects.addStandalone({ title: "未命名会话" });
        const updatedWorkspace = await api.projects.list();
        if (!cancelled) { setWorkspace(updatedWorkspace); setActiveThread({ type: "standalone", ...thread }); setView("standalone"); }
      }
    }).catch((error) => setFatalError(String(error.message || error)));
    api.models.list().then(({ models: nextModels }) => {
      if (!cancelled) { setModels(nextModels); setModelsError(""); }
    }).catch((error) => {
      if (!cancelled) setModelsError(String(error.message || error));
    }).finally(() => {
      if (!cancelled) setModelsLoading(false);
    });
    api.system.info().then((info) => { if (!cancelled) setSystemInfo(info); }).catch(() => {});
    const off = api.terminal.onData((data) => setTerminalOutput((current) => `${current}${data}`));
    return () => { cancelled = true; off(); };
  }, []);

  useEffect(() => {
    if (activeProject) {
      refreshGit(activeProject.id);
      api.git.branches(activeProject.id).then(setBranches).catch(() => setBranches([]));
    } else { setGitState({ branch: "—", files: [] }); setBranches([]); }
  }, [activeProject?.id]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.metaKey && event.key === ",") { event.preventDefault(); setView("settings"); }
      if (event.metaKey && event.key.toLowerCase() === "n") { event.preventDefault(); newStandalone(); }
      if (event.ctrlKey && event.key === "`") { event.preventDefault(); toggleTerminal(); }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "g") { event.preventDefault(); openReview(); }
      if (event.key === "Escape") { setModelOpen(null); setSandboxOpen(false); setBranchOpen(false); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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

  async function renameActiveThread() {
    if (!activeThread) return;
    const title = window.prompt("输入新的会话名称", activeThread.title)?.trim();
    if (!title || title === activeThread.title) return;
    try {
      const updated = await api.threads.update({ type: activeThread.type, projectId: activeThread.projectId, threadId: activeThread.id, title });
      setActiveThread((current) => ({ ...current, ...updated }));
      await reloadWorkspace();
      notify("会话已重命名");
    } catch (error) { notify(String(error.message || error)); }
  }

  async function removeActiveThread() {
    if (!activeThread || !window.confirm(`从 Rux 中移除会话“${activeThread.title}”？`)) return;
    try {
      const { workspace: nextWorkspace } = await api.threads.remove({ type: activeThread.type, projectId: activeThread.projectId, threadId: activeThread.id });
      setWorkspace(nextWorkspace);
      const project = nextWorkspace.projects.find((item) => item.threads.length);
      if (project) selectProjectThread(project, project.threads[0]);
      else if (nextWorkspace.standaloneThreads[0]) selectStandalone(nextWorkspace.standaloneThreads[0]);
      else await newStandalone();
      notify("会话已移除");
    } catch (error) { notify(String(error.message || error)); }
  }

  async function copyConversation() {
    const title = activeThread?.title || "Rux 会话";
    const body = activeMessages.map((message) => `## ${message.role === "user" ? "用户" : "Rux"}\n\n${message.text}`).join("\n\n");
    await api.system.copy(`# ${title}\n\n${body || "暂无消息"}`);
    notify("会话内容已复制");
  }

  async function addFiles() {
    try {
      const paths = await api.system.chooseFiles();
      setAttachments((current) => [...new Set([...current, ...paths])].slice(0, 8));
    } catch (error) { notify(String(error.message || error)); }
  }

  async function selectSandbox(sandboxMode) {
    if (sandboxMode === "danger-full-access" && !window.confirm("完全访问权限允许 Codex 访问互联网和电脑上的任何文件，并跳过操作批准。确认启用？")) return;
    try { await saveSettings({ sandboxMode }); setSandboxOpen(false); notify(`权限已切换为${sandboxLabels[sandboxMode]}`); }
    catch (error) { notify(String(error.message || error)); }
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
    recognition.onresult = (event) => { const text = Array.from(event.results).map((result) => result[0].transcript).join(""); setComposerValue(text); };
    recognition.onerror = (event) => notify(`语音输入失败：${event.error}`);
    recognition.onend = () => { setListening(false); window.__ruxSpeechRecognition = null; };
    window.__ruxSpeechRecognition = recognition;
    recognition.start();
  }

  async function switchBranch(branch) {
    if (!activeProject || branch === gitState.branch) { setBranchOpen(false); return; }
    if (gitState.files.length && !window.confirm(`当前有 ${gitState.files.length} 个变更，仍要切换到 ${branch}？`)) return;
    try { const status = await api.git.switchBranch({ projectId: activeProject.id, branch }); setGitState(status); setBranchOpen(false); notify(`已切换到 ${branch}`); }
    catch (error) { notify(String(error.message || error)); }
  }

  async function openRemote() {
    if (!activeProject) return;
    try {
      const remote = await api.git.remote(activeProject.id);
      if (!remote) { notify("当前项目没有 origin 远程地址"); return; }
      const url = remote.startsWith("git@") ? `https://${remote.slice(4).replace(":", "/").replace(/\.git$/, "")}` : remote.replace(/\.git$/, "");
      await api.system.openExternal(url);
    } catch (error) { notify(String(error.message || error)); }
  }

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
      const result = await api.agent.send({ projectId: activeProject?.id, prompt, model: settings.model, reasoning: settings.reasoning, sandboxMode: settings.sandboxMode, images: attachments, webSearch, threadId: activeThread.codexThreadId });
      const assistantMessage = { id: crypto.randomUUID(), role: "assistant", text: result.text };
      setMessages((current) => ({ ...current, [activeThread.id]: [...(current[activeThread.id] || []), assistantMessage] }));
      if (result.threadId && result.threadId !== activeThread.codexThreadId) {
        const updated = await api.threads.update({ type: activeThread.type, projectId: activeThread.projectId, threadId: activeThread.id, codexThreadId: result.threadId, title: activeThread.title.startsWith("未命名") || activeThread.title === "项目会话" ? prompt.slice(0, 28) : undefined });
        setActiveThread((current) => ({ ...current, ...updated })); await reloadWorkspace();
      }
      if (activeProject) await refreshGit(activeProject.id);
      setAttachments([]);
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
  async function commitOrPush() {
    if (!activeProject) return;
    const message = window.prompt("输入提交信息；留空则仅推送当前分支", "");
    if (message === null) return;
    const push = window.confirm(message.trim() ? "提交完成后是否推送到 origin？" : "确认推送当前分支到 origin？");
    if (!message.trim() && !push) return;
    setBusy(true);
    try { const status = await api.git.commitPush({ projectId: activeProject.id, message, push }); setGitState(status); notify(push ? "Git 提交/推送已完成" : "Git 提交已完成"); }
    catch (error) { notify(String(error.message || error)); }
    finally { setBusy(false); }
  }
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
  if (view === "settings") return <div className="app-frame"><SettingsScreen settings={settings} auth={auth} models={models} systemInfo={systemInfo} projectCount={workspace.projects.length} activeProject={activeProject} gitState={gitState} onBack={() => setView(isStandalone ? "standalone" : "project")} onSave={saveSettings} onTest={testSettings} onLogin={async () => { await api.auth.login(); setTimeout(async () => setAuth(await api.auth.status()), 1500); }} onLogout={async () => { await api.auth.logout(); setAuth(await api.auth.status()); return "已退出"; }} onNotify={notify} />{toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={18} />{toast}</div>}</div>;

  const composerProps = { settings, auth, models, modelsLoading, modelsError, modelOpen, sandboxOpen, attachments, listening, onToggleModel: (menu) => { setModelOpen((open) => open === menu ? null : menu); setSandboxOpen(false); }, onSelectModel: selectModel, onSelectReasoning: selectReasoning, onToggleSandbox: () => { setSandboxOpen((open) => !open); setModelOpen(null); }, onSelectSandbox: selectSandbox, onPermissionInfo: () => notify("可在设置 > 权限中修改默认批准方式"), onAddFiles: addFiles, onRemoveAttachment: (path) => setAttachments((current) => current.filter((item) => item !== path)), onVoice: toggleVoice, onAssociateProject: () => { const project = workspace.projects[0]; const thread = project?.threads[0]; if (project && thread) selectProjectThread(project, thread); else if (project) newProjectThread(project); }, value: composerValue, onChange: setComposerValue, onSend: sendMessage, sending };
  return (
    <div className="app-frame">
      <Sidebar workspace={workspace} auth={auth} expandedProjects={expandedProjects} activeThread={activeThread} onToggleProject={(projectId) => setExpandedProjects((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])} onSelectProjectThread={selectProjectThread} onSelectStandalone={selectStandalone} onAddProject={() => setModalStep("choose")} onRemoveProject={removeProject} onNewProjectThread={newProjectThread} onNewStandalone={newStandalone} onOpenSettings={() => setView("settings")} />
      <main className="app-stage">
        <TopBar activeThread={activeThread} rightPanelOpen={rightPanelOpen} onToggleRightPanel={() => setRightPanelOpen((open) => !open)} onOpenSettings={() => setView("settings")} onOpenPath={() => activeProject && api.system.openPath(activeProject.id).catch((error) => notify(String(error.message || error)))} onCopyPath={() => activeProject && api.system.copy(activeProject.path).then(() => notify("项目路径已复制"))} onShare={copyConversation} onRename={renameActiveThread} onRemoveThread={removeActiveThread} />
        <div className={`stage-body ${terminalOpen ? "terminal-is-open" : ""}`}><div className="work-pane"><div className="main-content">{view === "review" ? <ReviewScreen gitState={gitState} selectedFile={selectedFile} diff={diff} onSelectFile={selectDiff} onBack={() => setView("project")} onStageAll={() => stage(gitState.files.map((file) => file.path))} onStageFile={() => stage([selectedFile])} onDiscard={discardSelected} busy={busy} /> : <ConversationScreen standalone={isStandalone} activeThread={activeThread} messages={activeMessages} sending={sending} composerProps={composerProps} gitState={gitState} onReview={openReview} terminalOpen={terminalOpen} onToggleTerminal={toggleTerminal} />}</div>{showEnvironment && <EnvironmentPanel gitState={gitState} branches={branches} branchOpen={branchOpen} onToggleBranch={() => setBranchOpen((open) => !open)} onSwitchBranch={switchBranch} onRefresh={() => activeProject && refreshGit(activeProject.id)} onCommitPush={commitOrPush} onReview={openReview} />}{showToolLauncher && <ToolLauncher onReview={openReview} onOpenPath={() => activeProject && api.system.openPath(activeProject.id)} onOpenRemote={openRemote} onNewStandalone={newStandalone} />}{isStandalone && rightPanelOpen && <UtilityPanel webSearch={webSearch} onToggleWebSearch={() => { setWebSearch((enabled) => !enabled); notify(webSearch ? "已关闭网页搜索" : "已启用网页搜索"); }} onAddFiles={addFiles} />}</div>{terminalOpen && view === "project" && <TerminalPanel output={terminalOutput} command={terminalCommand} onCommandChange={setTerminalCommand} onRun={runTerminalCommand} onClose={closeTerminal} projectName={activeProject?.name || "终端"} />}</div>
      </main>
      {modalStep && <AddProjectModal step={modalStep} defaultParent={defaultParent} onClose={() => setModalStep(null)} onStep={setModalStep} onComplete={completeProjectAction} />}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={18} />{toast}</div>}
    </div>
  );
}

export default App;
