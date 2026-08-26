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
  Columns,
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
  Rows,
  Robot,
  ShareNetwork,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  TerminalWindow,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import RuxAssistantThread from "./assistant/RuxAssistantThread";

const api = window.rux;

const fallbackWorkspace = {
  projects: [],
  standaloneThreads: [],
};

const fallbackAgents = [
  { id: "codex", name: "Codex", installed: false, managed: true, integrated: true, version: "0.149.1", modes: [{ id: "default", label: "默认" }, { id: "plan", label: "计划" }] },
];

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
const workspaceTools = [
  { id: "review", label: "审查", Icon: FileText, shortcut: "⌃⇧G", projectOnly: true },
  { id: "terminal", label: "终端", Icon: TerminalWindow, shortcut: "⌃`", projectOnly: true },
  { id: "browser", label: "浏览器", Icon: Globe, shortcut: "⌘T", projectOnly: true },
  { id: "files", label: "文件", Icon: FolderOpen, shortcut: "⌘P", projectOnly: true },
  { id: "chat", label: "侧边聊天", Icon: ChatCircle, shortcut: "⌥⌘S", projectOnly: false },
];

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem("rux.messages.v1") || "{}");
  } catch {
    return {};
  }
}

function loadAgentPreferences() {
  const fallback = {
    codex: { model: "", reasoning: "high" },
    "claude-code": { model: "default", reasoning: "high" },
    pi: { model: "", reasoning: "medium" },
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem("rux.agent-preferences.v1") || "{}") };
  } catch {
    return fallback;
  }
}

function itemToMessagePart(item, startedAt = Date.now()) {
  if (!item?.id) return null;
  if (item.type === "agentMessage") return { type: "text", text: item.text || "", status: { type: "running" }, _itemId: item.id };
  if (item.type === "plan") return { type: "reasoning", text: item.text || "", unstable_summary: "计划", status: { type: "running" }, _itemId: item.id };
  if (item.type === "reasoning") return { type: "reasoning", text: [...(item.summary || []), ...(item.content || [])].join("\n"), status: { type: "running" }, _itemId: item.id };
  const toolName = item.type;
  if (["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "collabAgentToolCall", "subAgentActivity"].includes(toolName)) {
    const args = item.type === "commandExecution"
      ? { command: item.command, cwd: item.cwd }
      : item.type === "fileChange"
        ? { changes: item.changes }
        : item.type === "mcpToolCall"
          ? { server: item.server, tool: item.tool, ...(item.arguments || {}) }
          : item.type === "webSearch"
            ? { query: item.query || item.action?.query || "" }
            : { ...item };
    return { type: "tool-call", toolCallId: item.id, toolName, args, argsText: JSON.stringify(args), timing: { startedAt }, _itemId: item.id };
  }
  return null;
}

function completedItemResult(item) {
  if (item.type === "commandExecution") return { output: item.aggregatedOutput || "", exitCode: item.exitCode, status: item.status };
  if (item.type === "fileChange") return { summary: `${item.changes?.length || 0} 个文件变更`, changes: item.changes, status: item.status };
  if (item.type === "mcpToolCall") return item.error ? { error: item.error } : item.result || { status: item.status };
  if (item.type === "dynamicToolCall") return { output: (item.contentItems || []).map((part) => part.text || JSON.stringify(part)).join("\n"), contentItems: item.contentItems, success: item.success, status: item.status };
  if (item.type === "webSearch") return { status: "completed", action: item.action };
  if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") return { status: item.status || "completed", agentsStates: item.agentsStates };
  return { status: item.status || "completed" };
}

function reduceStreamEvent(message, event) {
  const parts = [...(message.parts || [])];
  const findPart = () => parts.findIndex((part) => part._itemId === event.itemId || part.toolCallId === event.itemId);
  const updatePart = (create, update) => {
    let index = findPart();
    if (index < 0 && create) { parts.push(create); index = parts.length - 1; }
    if (index >= 0) parts[index] = update(parts[index]);
  };
  if (event.type === "item-started") {
    const part = itemToMessagePart(event.item);
    if (part && findPart() < 0) parts.push(part);
  } else if (event.type === "text-delta") {
    updatePart({ type: "text", text: "", status: { type: "running" }, _itemId: event.itemId }, (part) => ({ ...part, text: `${part.text || ""}${event.delta || ""}` }));
  } else if (event.type === "reasoning-delta") {
    updatePart({ type: "reasoning", text: "", status: { type: "running" }, _itemId: event.itemId }, (part) => ({ ...part, text: `${part.text || ""}${event.delta || ""}` }));
  } else if (event.type === "tool-output-delta") {
    updatePart(null, (part) => ({ ...part, result: { ...(part.result || {}), output: `${part.result?.output || ""}${event.delta || ""}` } }));
  } else if (event.type === "item-completed" && event.item) {
    const item = event.item;
    updatePart(itemToMessagePart(item), (part) => {
      if (item.type === "agentMessage") return { ...part, text: item.text || part.text, status: { type: "complete" } };
      if (item.type === "reasoning" || item.type === "plan") return { ...part, text: item.text || [...(item.summary || []), ...(item.content || [])].join("\n") || part.text, status: { type: "complete" } };
      return { ...part, result: completedItemResult(item), isError: ["failed", "declined"].includes(item.status), timing: { ...(part.timing || {}), completedAt: Date.now() } };
    });
  } else if (event.type === "approval-request" && event.approval) {
    updatePart({ type: "tool-call", toolCallId: event.itemId, toolName: event.approval.method?.includes("fileChange") ? "fileChange" : "commandExecution", args: event.approval, argsText: JSON.stringify(event.approval), _itemId: event.itemId }, (part) => ({ ...part, approval: { id: event.approval.id, options: [{ id: "allow-once", kind: "allow-once", label: "允许一次" }, { id: "allow-session", kind: "allow-always", label: "本次会话允许" }, { id: "reject-once", kind: "reject-once", label: "拒绝" }] } }));
  } else if (event.type === "turn-completed") {
    return { ...message, parts: parts.map((part) => part.status?.type === "running" ? { ...part, status: { type: "complete" } } : part), status: event.status === "completed" ? "complete" : "error", error: event.error };
  } else if (event.type === "error") {
    parts.push({ type: "text", text: event.error || "Agent 执行失败", status: { type: "incomplete", reason: "error" }, _itemId: `error-${Date.now()}` });
    return { ...message, parts, status: "error", error: event.error };
  }
  return { ...message, parts };
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
  onOpenProjectPath,
  onCopyProjectPath,
  onNewProjectThread,
  onNewStandalone,
  onOpenSettings,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState(null);
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
                    <button type="button" className="project-row" onClick={() => { onToggleProject(project.id); setProjectMenuId(null); }} onDoubleClick={() => onOpenProjectPath(project)} onContextMenu={(event) => { event.preventDefault(); setProjectMenuId(project.id); }}>
                      {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                      <Folder size={18} /><span>{project.name}</span>
                    </button>
                    <IconButton label={`项目操作 ${project.name}`} className="project-action-button" active={projectMenuId === project.id} onClick={(event) => { event.stopPropagation(); setProjectMenuId((current) => current === project.id ? null : project.id); }}><DotsThree size={17} /></IconButton>
                  </div>
                  {projectMenuId === project.id && <div className="project-action-popover" role="menu"><div className="project-location"><FolderOpen size={16} /><span><strong>{project.name}</strong><small title={project.path}>{project.path}</small></span></div><button type="button" onClick={() => { setProjectMenuId(null); onOpenProjectPath(project); }}><FolderOpen size={16} />在 Finder 中打开</button><button type="button" onClick={() => { setProjectMenuId(null); onCopyProjectPath(project); }}><Paperclip size={16} />复制项目路径</button><button type="button" onClick={() => { setProjectMenuId(null); onNewProjectThread(project); }}><Plus size={16} />新建项目会话</button><button type="button" className="danger-text" onClick={() => { setProjectMenuId(null); onRemoveProject(project); }}><Trash size={16} />从 Rux 移除</button></div>}
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

function TopBar({ activeThread, bottomPanelOpen, rightPanelOpen, onToggleBottomPanel, onToggleRightPanel, onOpenSettings, onOpenPath, onCopyPath, onShare, onRename, onRemoveThread }) {
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
        <IconButton label="切换底部面板" active={bottomPanelOpen} onClick={onToggleBottomPanel}><Rows size={19} /></IconButton>
        <IconButton label="切换右侧面板" active={rightPanelOpen} onClick={onToggleRightPanel}><Columns size={19} /></IconButton>
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

function ToolLauncher({ activeTool, hasProject, onSelectTool }) {
  return (
    <aside className="tool-launcher" aria-label="工作区工具">
      {workspaceTools.map(({ id, label, Icon, shortcut, projectOnly }) => <button type="button" key={id} className={activeTool === id ? "is-active" : ""} disabled={projectOnly && !hasProject} onClick={() => onSelectTool(id)}><Icon size={18} /><span>{label}</span><kbd>{shortcut}</kbd></button>)}
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

function ModelPopover({ mode, settings, auth, models, loading, error, onSelectModel, onSelectReasoning, connectionLabel }) {
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
      <div className="popover-footer">{connectionLabel || (settings.provider === "codex" ? `${modelDisplayName(settings, models)} · GPT OAuth` : settings.serviceName)}</div>
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

function ConversationScreen({ standalone, activeThread, assistantProps, gitState, onReview }) {
  return (
    <div className={`conversation-screen ${standalone ? "standalone-screen" : ""}`}>
      <RuxAssistantThread emptyTitle={standalone ? "开始独立会话" : `在 ${activeThread.projectName} 中开始任务`} {...assistantProps} />
      {!standalone && gitState.files.length > 0 && (
        <div className="live-change-summary"><FileText size={18} /><strong>{gitState.files.length} 个真实文件变更</strong><button type="button" className="secondary-button" onClick={onReview}><Eye size={17} />审查变更</button></div>
      )}
    </div>
  );
}

function TerminalPanel({ output, command, onCommandChange, onRun, onClose, projectName, embedded = false }) {
  return (
    <section className="terminal-panel">
      {!embedded && <div className="terminal-tabs"><div className="terminal-tab"><TerminalWindow size={17} /><span>{projectName}</span></div><IconButton label="关闭终端" className="terminal-close" onClick={onClose}><X size={18} /></IconButton></div>}
      <pre className="terminal-body" aria-label="终端输出">{output || "终端已启动\n"}</pre>
      <form className="terminal-command" onSubmit={(event) => { event.preventDefault(); onRun(); }}>
        <span>$</span><input aria-label="终端命令" value={command} onChange={(event) => onCommandChange(event.target.value)} autoComplete="off" /><button type="submit" className="secondary-button">运行</button>
      </form>
    </section>
  );
}

function WorkspaceDock({ activeTool, hasProject, gitState, terminalProps, remoteUrl, projectFiles, sideMessages, sideValue, sideSending, onSelectTool, onClose, onOpenReview, onOpenRemote, onOpenFile, onSideValue, onSendSide }) {
  return (
    <section className="workspace-dock" aria-label="底部工作区面板">
      <header className="workspace-dock-header"><div className="workspace-dock-tabs">{workspaceTools.map(({ id, label, Icon, projectOnly }) => <button type="button" key={id} className={activeTool === id ? "is-active" : ""} disabled={projectOnly && !hasProject} onClick={() => onSelectTool(id)}><Icon size={15} />{label}</button>)}</div><IconButton label="关闭底部面板" onClick={onClose}><X size={16} /></IconButton></header>
      <div className="workspace-dock-content">
        {activeTool === "review" && <div className="dock-review"><div><strong>{gitState.files.length} 个文件变更</strong><span>{gitState.branch || "—"}</span></div><div className="dock-file-chips">{gitState.files.slice(0, 8).map((file) => <span key={file.path}>{file.path}<small><b>+{file.plus}</b> <em>−{file.minus}</em></small></span>)}</div><button type="button" className="secondary-button" onClick={onOpenReview}><Eye size={15} />打开完整审查</button></div>}
        {activeTool === "terminal" && <TerminalPanel {...terminalProps} />}
        {activeTool === "browser" && <div className="dock-empty-tool"><Globe size={24} /><strong>{remoteUrl ? "项目远程仓库" : "未配置远程仓库"}</strong><span>{remoteUrl || "为当前项目添加 origin 后，可从这里打开。"}</span><button type="button" className="secondary-button" disabled={!remoteUrl} onClick={onOpenRemote}>在浏览器中打开</button></div>}
        {activeTool === "files" && <div className="dock-files">{projectFiles.length ? projectFiles.map((path) => <button type="button" key={path} onDoubleClick={() => onOpenFile(path)}><File size={14} /><span>{path}</span><ArrowSquareOut size={13} /></button>) : <div className="dock-empty-tool"><FolderOpen size={24} /><strong>项目中没有可显示的文件</strong></div>}</div>}
        {activeTool === "chat" && <div className="dock-side-chat"><div className="dock-chat-messages">{sideMessages.length ? sideMessages.map((message) => <p key={message.id} className={message.role === "user" ? "is-user" : "is-agent"}>{message.text}</p>) : <span>针对当前工作区快速提问，不影响主会话。</span>}</div><form onSubmit={(event) => { event.preventDefault(); onSendSide(); }}><input aria-label="侧边聊天消息" value={sideValue} onChange={(event) => onSideValue(event.target.value)} placeholder="向 Rux 提问" disabled={sideSending} /><button type="submit" aria-label="发送侧边聊天消息" disabled={sideSending || !sideValue.trim()}>{sideSending ? <CircleNotch size={15} className="spin" /> : <ArrowUp size={15} />}</button></form></div>}
      </div>
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

function ProviderProfilesSettings({ store, onSave, onRemove, onSetActive, onTest, onNotify }) {
  const empty = { id: "", name: "", protocol: "openai-responses", baseUrl: "", hasApiKey: false, headers: {}, compatibleAgents: ["rux-native"], models: [] };
  const [selectedId, setSelectedId] = useState(store.activeProfileId || store.profiles[0]?.id || "");
  const [draft, setDraft] = useState(empty);
  const [apiKey, setApiKey] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const profile = store.profiles.find((item) => item.id === selectedId) || store.profiles.find((item) => item.id === store.activeProfileId);
    if (!profile) { setDraft(empty); setHeadersText(""); setModelsText(""); return; }
    setSelectedId(profile.id);
    setDraft(profile);
    setHeadersText(Object.entries(profile.headers || {}).map(([key, value]) => `${key}: ${value}`).join("\n"));
    setModelsText((profile.models || []).map((model) => `${model.id} | ${model.name || model.id} | ${(model.reasoningLevels || []).join(",")}`).join("\n"));
    setApiKey("");
  }, [selectedId, store.activeProfileId, store.profiles]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const execute = async (action) => { setBusy(true); setStatus(""); try { const message = await action(); if (message) setStatus(message); } catch (error) { setStatus(String(error.message || error)); } finally { setBusy(false); } };
  const parseHeaders = () => Object.fromEntries(headersText.split(/\r?\n/).filter((line) => line.trim()).map((line) => { const index = line.indexOf(":"); if (index <= 0) throw new Error(`Header 格式错误：${line}`); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }));
  const parseModels = () => modelsText.split(/\r?\n/).filter((line) => line.trim()).map((line) => { const [id, name, levels = ""] = line.split("|").map((part) => part.trim()); return { id, name: name || id, reasoningLevels: levels.split(",").map((value) => value.trim()).filter(Boolean) }; });
  return (
    <div className="provider-settings-layout">
      <aside className="provider-profile-list">
        <button type="button" className="secondary-button provider-add" onClick={() => { setSelectedId(""); setDraft(empty); setHeadersText(""); setModelsText(""); setApiKey(""); }}>+ 新建 Provider</button>
        {store.profiles.map((profile) => <button type="button" key={profile.id} className={draft.id === profile.id ? "is-selected" : ""} onClick={() => setSelectedId(profile.id)}><span><strong>{profile.name}</strong><small>{profile.protocol} · {profile.models.length} 个模型</small></span>{store.activeProfileId === profile.id && <em>当前</em>}</button>)}
        {!store.profiles.length && <p>尚未配置 Provider</p>}
      </aside>
      <section className="provider-profile-editor">
        <div className="settings-group form-settings">
          <label className="settings-row"><span>名称</span><input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="例如 公司代理" /></label>
          <label className="settings-row"><span>协议</span><select value={draft.protocol} onChange={(event) => update({ protocol: event.target.value })}><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option><option value="ollama">Ollama / OpenAI Compatible</option></select></label>
          <label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
          <label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={draft.hasApiKey ? "已安全保存；留空则不修改" : "输入 API key"} /><Eye size={17} /></span></label>
          <label className="settings-row provider-multiline"><span>自定义 Headers<small>每行 Key: Value；认证请使用 API key</small></span><textarea value={headersText} onChange={(event) => setHeadersText(event.target.value)} placeholder="X-Organization: team-a" /></label>
          <label className="settings-row provider-multiline"><span>模型<small>每行：ID | 显示名称 | reasoning levels</small></span><textarea value={modelsText} onChange={(event) => setModelsText(event.target.value)} placeholder={"gpt-5.6-terra | GPT-5.6 Terra | low,medium,high,xhigh\nqwen3-coder | Qwen Coder | low,medium,high"} /></label>
          <div className="settings-row"><span>兼容运行时</span><div className="provider-agent-checks">{[["rux-native", "Rux Native"], ["pi", "Pi"]].map(([id, label]) => <label key={id}><input type="checkbox" checked={draft.compatibleAgents.includes(id)} onChange={(event) => update({ compatibleAgents: event.target.checked ? [...new Set([...draft.compatibleAgents, id])] : draft.compatibleAgents.filter((value) => value !== id) })} />{label}</label>)}</div></div>
          <div className="settings-row settings-actions provider-actions">
            {draft.id && <button type="button" className="danger-link" disabled={busy} onClick={() => { if (window.confirm(`删除 Provider“${draft.name}”？此操作只删除 Rux 中的配置。`)) execute(async () => { await onRemove(draft.id); setSelectedId(""); return "Provider 已删除"; }); }}>删除</button>}
            {draft.id && <button type="button" className="secondary-button" disabled={busy} onClick={() => execute(async () => (await onTest(draft.id)).message)}>测试连接</button>}
            {draft.id && store.activeProfileId !== draft.id && <button type="button" className="secondary-button" disabled={busy} onClick={() => execute(async () => { await onSetActive(draft.id); return "已设为当前 Provider"; })}>设为当前</button>}
            <button type="button" className="primary-button" disabled={busy} onClick={() => execute(async () => { const saved = await onSave({ ...draft, apiKey, headers: parseHeaders(), models: parseModels() }); setSelectedId(saved.id); setApiKey(""); onNotify("Provider 配置已保存"); return "已安全保存"; })}>保存配置</button>
          </div>
        </div>
        {status && <p className={/失败|错误/.test(status) ? "settings-status error-text" : "settings-status connected"}>{status}</p>}
      </section>
    </div>
  );
}

function SettingsScreen({ settings, auth, models, agents, modelsByAgent, providerStore, onProviderSave, onProviderRemove, onProviderSetActive, onProviderTest, systemInfo, projectCount, activeProject, gitState, onBack, onSave, onTest, onLogin, onLogout, onNotify }) {
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
    ["general", "常规", GearSix], ["agents", "底座 Agent", Robot], ["providers", "Provider 配置", Globe], ["appearance", "外观", Palette], ["permissions", "权限", LockKey], ["models", "模型与连接", SlidersHorizontal], ["shortcuts", "键盘快捷键", Keyboard], ["git", "Git", GitBranch], ["environment", "环境", Monitor],
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
        {section === "agents" && <section className="settings-section"><h2>底座 Agent</h2><div className="agent-settings-list">{agents.map((agent) => <article className="agent-settings-card" key={agent.id}><span className="agent-settings-icon"><Robot size={20} /></span><span className="agent-settings-copy"><strong>{agent.name}</strong><small>{agent.managed ? `${agent.version} · ${agent.installed ? "已由 Rux 下载" : "首次使用时自动下载"}` : `${agent.version || "运行时"} · ${agent.path || ""}`}</small><em>{agent.id === "claude-code" ? (agent.auth?.connected ? `已登录 · ${agent.auth.authMethod || "Claude 账户"}` : "需要登录 Claude") : agent.id === "codex" ? (auth.connected ? "GPT OAuth 已连接" : "需要登录 Codex") : providerStore.profiles.some((profile) => profile.compatibleAgents.includes("pi")) ? "Provider 已配置" : "需要配置兼容 Pi 的 Provider"}</em></span><span className={`agent-settings-status ${agent.installed && agent.integrated ? "is-ready" : ""}`}>{agent.managed ? (agent.installed ? "已下载" : "未下载") : agent.integrated ? "可用" : "待接入"}</span><div className="agent-settings-modes">{agent.modes?.map((mode) => <span key={mode.id}>{mode.label}</span>)}</div><small className="agent-settings-models">{agent.id === "codex" ? `${models.length} 个可用模型` : modelsByAgent[agent.id]?.length ? `${modelsByAgent[agent.id].length} 个可用模型` : "选择该 Agent 后读取模型"}</small></article>)}</div></section>}
        {section === "providers" && <section className="settings-section provider-settings-section"><h2>Provider 配置</h2><p className="settings-help">配置 Rux Native 或 Pi 可使用的真实模型服务。API key 只保存在系统安全存储中。</p><ProviderProfilesSettings store={providerStore} onSave={onProviderSave} onRemove={onProviderRemove} onSetActive={onProviderSetActive} onTest={onProviderTest} onNotify={onNotify} /></section>}
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
  const [modelsByAgent, setModelsByAgent] = useState({});
  const [agents, setAgents] = useState(fallbackAgents);
  const [selectedAgent, setSelectedAgent] = useState("codex");
  const [agentMode, setAgentMode] = useState("default");
  const [agentPreferences, setAgentPreferences] = useState(loadAgentPreferences);
  const [providerStore, setProviderStore] = useState({ activeProfileId: "", profiles: [] });
  const [runtimeProgress, setRuntimeProgress] = useState({});
  const [systemInfo, setSystemInfo] = useState({});
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [defaultParent, setDefaultParent] = useState("");
  const [expandedProjects, setExpandedProjects] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [view, setView] = useState("project");
  const [modalStep, setModalStep] = useState(null);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activeTool, setActiveTool] = useState("terminal");
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
  const [projectFiles, setProjectFiles] = useState([]);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [sideMessages, setSideMessages] = useState([]);
  const [sideValue, setSideValue] = useState("");
  const [sideSending, setSideSending] = useState(false);
  const [sideThreadId, setSideThreadId] = useState("");
  const [messages, setMessages] = useState(loadMessages);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [gitState, setGitState] = useState({ branch: "—", files: [] });
  const [selectedFile, setSelectedFile] = useState("");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [fatalError, setFatalError] = useState("");
  const runContexts = useRef(new Map());
  const activeThreadRef = useRef(null);
  const activeProjectRef = useRef(null);

  const activeMessages = activeThread ? messages[activeThread.id] || [] : [];
  const isStandalone = activeThread?.type === "standalone";
  const activeProject = activeThread?.type === "project" ? workspace.projects.find((project) => project.id === activeThread.projectId) : null;
  const activeModels = selectedAgent === "codex" ? models : modelsByAgent[selectedAgent] || [];
  const activePreference = selectedAgent === "codex"
    ? { model: settings.model, reasoning: settings.reasoning }
    : agentPreferences[selectedAgent] || { model: "default", reasoning: "high" };
  const activeComposerSettings = { ...settings, ...activePreference, provider: selectedAgent === "codex" ? settings.provider : "codex" };

  useEffect(() => { activeThreadRef.current = activeThread; }, [activeThread]);
  useEffect(() => { activeProjectRef.current = activeProject; }, [activeProject]);

  useEffect(() => { localStorage.setItem("rux.messages.v1", JSON.stringify(messages)); }, [messages]);
  useEffect(() => { localStorage.setItem("rux.agent-preferences.v1", JSON.stringify(agentPreferences)); }, [agentPreferences]);
  useEffect(() => { document.documentElement.style.setProperty("--ui-font-size", `${settings.uiFontSize || 14}px`); }, [settings.uiFontSize]);

  useEffect(() => {
    if (!api) { setFatalError("当前页面未运行在 Electron 客户端中"); return undefined; }
    let cancelled = false;
    const offRuntime = api.runtimes.onProgress((progress) => {
      if (cancelled) return;
      setRuntimeProgress((current) => ({ ...current, [progress.agentId]: progress }));
      if (progress.state === "ready") api.agents.list().then(({ agents: nextAgents }) => { if (!cancelled) setAgents(nextAgents); }).catch(() => {});
    });
    Promise.all([api.projects.list(), api.settings.get(), api.auth.status(), api.projects.defaultParent()]).then(async ([nextWorkspace, nextSettings, nextAuth, parent]) => {
      if (cancelled) return;
      setWorkspace(nextWorkspace); setSettings(nextSettings); setAuth(nextAuth); setDefaultParent(parent);
      setAgentPreferences((current) => ({ ...current, codex: { model: nextSettings.model, reasoning: nextSettings.reasoning } }));
      const firstProject = nextWorkspace.projects[0];
      const firstThread = firstProject?.threads[0];
      if (firstProject && firstThread) {
        setExpandedProjects([firstProject.id]);
        setActiveThread({ type: "project", projectId: firstProject.id, projectName: firstProject.name, projectPath: firstProject.path, ...firstThread });
        setSelectedAgent(firstThread.agentId || "codex");
        setAgentMode(firstThread.agentMode || "default");
      } else if (nextWorkspace.standaloneThreads[0]) { setActiveThread({ type: "standalone", ...nextWorkspace.standaloneThreads[0] }); setSelectedAgent(nextWorkspace.standaloneThreads[0].agentId || "codex"); setAgentMode(nextWorkspace.standaloneThreads[0].agentMode || "default"); }
      else {
        const thread = await api.projects.addStandalone({ title: "未命名会话" });
        const updatedWorkspace = await api.projects.list();
        if (!cancelled) { setWorkspace(updatedWorkspace); setActiveThread({ type: "standalone", ...thread }); setView("standalone"); }
      }
      if (!cancelled) setWorkspaceReady(true);
    }).catch((error) => setFatalError(String(error.message || error)));
    api.agents.list().then(({ agents: detectedAgents }) => {
      if (!cancelled && detectedAgents?.length) setAgents(detectedAgents);
    }).catch(() => {});
    api.system.info().then((info) => { if (!cancelled) setSystemInfo(info); }).catch(() => {});
    api.providers.list().then((store) => { if (!cancelled) setProviderStore(store); }).catch(() => {});
    const off = api.terminal.onData((data) => setTerminalOutput((current) => `${current}${data}`));
    return () => { cancelled = true; off(); offRuntime(); };
  }, []);

  useEffect(() => {
    if (!api || !workspaceReady) return;
    let cancelled = false;
    setModelsLoading(true);
    api.models.list({ agentId: selectedAgent, projectId: activeProject?.id }).then(({ models: nextModels }) => {
      if (cancelled) return;
      if (selectedAgent === "codex") setModels(nextModels);
      else setModelsByAgent((current) => ({ ...current, [selectedAgent]: nextModels }));
      setModelsError("");
      if (selectedAgent === "codex") {
        setAgentPreferences((current) => {
          const existing = current.codex || {};
          const selected = nextModels.find((model) => model.model === existing.model) || nextModels.find((model) => model.isDefault) || nextModels[0];
          return selected ? { ...current, codex: { model: selected.model, reasoning: selected.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === existing.reasoning) ? existing.reasoning : selected.defaultReasoningEffort } } : current;
        });
        api.auth.status().then((nextAuth) => { if (!cancelled) setAuth(nextAuth); }).catch(() => {});
        return;
      }
      setAgentPreferences((current) => {
        const existing = current[selectedAgent] || {};
        const selected = nextModels.find((model) => model.model === existing.model) || nextModels.find((model) => model.isDefault) || nextModels[0];
        return selected ? { ...current, [selectedAgent]: { model: selected.model, reasoning: selected.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === existing.reasoning) ? existing.reasoning : selected.defaultReasoningEffort } } : current;
      });
    }).catch((error) => { if (!cancelled) setModelsError(String(error.message || error)); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceReady, selectedAgent, activeProject?.id, providerStore.activeProfileId, providerStore.profiles]);

  useEffect(() => {
    if (!api?.agent?.onEvent) return undefined;
    return api.agent.onEvent((event) => {
      const context = runContexts.current.get(event.runId);
      if (!context) return;
      if (event.type === "thread-started" && event.threadId) {
        context.threadId = event.threadId;
        api.threads.update({ type: context.type, projectId: context.projectId, threadId: context.localThreadId, agentId: context.agentId, nativeSessionId: event.threadId, agentMode: context.agentMode, codexThreadId: context.agentId === "codex" ? event.threadId : undefined, title: context.shouldRename ? context.prompt.slice(0, 28) : undefined }).then((updated) => {
          if (activeThreadRef.current?.id === context.localThreadId) setActiveThread((current) => ({ ...current, ...updated }));
          reloadWorkspace().catch(() => {});
        }).catch((error) => notify(String(error.message || error)));
      }
      if (event.turnId) context.turnId = event.turnId;
      setMessages((current) => {
        const threadMessages = current[context.localThreadId] || [];
        return {
          ...current,
          [context.localThreadId]: threadMessages.map((message) => message.id === context.assistantMessageId ? reduceStreamEvent(message, event) : message),
        };
      });
      if (event.type === "turn-completed" || event.type === "error") {
        runContexts.current.delete(event.runId);
        if (activeThreadRef.current?.id === context.localThreadId) setSending(false);
        if (context.projectId) refreshGit(context.projectId).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (activeProject) {
      refreshGit(activeProject.id);
      api.git.branches(activeProject.id).then(setBranches).catch(() => setBranches([]));
      api.files.list(activeProject.id).then(setProjectFiles).catch(() => setProjectFiles([]));
      api.git.remote(activeProject.id).then(setRemoteUrl).catch(() => setRemoteUrl(""));
    } else { setGitState({ branch: "—", files: [] }); setBranches([]); setProjectFiles([]); setRemoteUrl(""); }
    setSideMessages([]); setSideThreadId(""); setSideValue("");
  }, [activeProject?.id]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.metaKey && event.key === ",") { event.preventDefault(); setView("settings"); }
      if (event.metaKey && event.key.toLowerCase() === "n") { event.preventDefault(); newStandalone(); }
      if (event.ctrlKey && event.key === "`") { event.preventDefault(); selectWorkspaceTool("terminal"); }
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

  function selectProjectThread(project, thread) { setActiveThread({ type: "project", projectId: project.id, projectName: project.name, projectPath: project.path, ...thread }); setSelectedAgent(thread.agentId || "codex"); setAgentMode(thread.agentMode || "default"); setView("project"); setBottomPanelOpen(false); closeTerminal(); setModelOpen(null); }
  function selectStandalone(thread) { setActiveThread({ type: "standalone", ...thread }); setSelectedAgent(thread.agentId || "codex"); setAgentMode(thread.agentMode || "default"); setView("standalone"); setBottomPanelOpen(false); closeTerminal(); setModelOpen(null); }

  async function newProjectThread(project) { try { const thread = await api.projects.addThread({ projectId: project.id, title: "未命名会话" }); await reloadWorkspace(); selectProjectThread(project, thread); return thread; } catch (error) { notify(String(error.message || error)); return null; } }
  async function newStandalone() { try { const thread = await api.projects.addStandalone({ title: "未命名会话" }); await reloadWorkspace(); selectStandalone(thread); return thread; } catch (error) { notify(String(error.message || error)); return null; } }

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

  async function sendMessage(nextPrompt = composerValue) {
    const prompt = String(nextPrompt || "").trim(); if (!prompt || !activeThread || sending) return;
    const agentDefinition = agents.find((agent) => agent.id === selectedAgent);
    if (!agentDefinition?.integrated) { notify(`${agentDefinition?.name || selectedAgent} 适配器尚未启用`); return; }
    const runId = crypto.randomUUID();
    const userMessage = { id: crypto.randomUUID(), role: "user", text: prompt, parts: [{ type: "text", text: prompt }], createdAt: new Date().toISOString(), agentId: selectedAgent };
    const assistantMessage = { id: crypto.randomUUID(), role: "assistant", text: "", parts: [], status: "running", createdAt: new Date().toISOString(), agentId: selectedAgent };
    const nativeSessionId = activeThread.nativeSessionId || (selectedAgent === "codex" ? activeThread.codexThreadId : "") || "";
    const context = { runId, localThreadId: activeThread.id, assistantMessageId: assistantMessage.id, type: activeThread.type, projectId: activeThread.projectId, prompt, shouldRename: activeThread.title.startsWith("未命名") || activeThread.title === "项目会话", agentId: selectedAgent, agentMode, threadId: nativeSessionId, turnId: "" };
    runContexts.current.set(runId, context);
    setMessages((current) => ({ ...current, [activeThread.id]: [...(current[activeThread.id] || []), userMessage, assistantMessage] }));
    setComposerValue(""); setSending(true);
    try {
      const result = await api.agent.start({ runId, agentId: selectedAgent, projectId: activeProject?.id, prompt, model: activePreference.model, reasoning: activePreference.reasoning, sandboxMode: settings.sandboxMode, images: attachments, webSearch, threadId: nativeSessionId, nativeSessionId, mode: agentMode });
      context.threadId = result.threadId || result.sessionId || context.threadId;
      context.turnId = result.turnId || context.turnId;
      setAttachments([]);
    } catch (error) {
      runContexts.current.delete(runId);
      setMessages((current) => ({ ...current, [activeThread.id]: (current[activeThread.id] || []).map((message) => message.id === assistantMessage.id ? reduceStreamEvent(message, { type: "error", error: String(error.message || error) }) : message) }));
      setSending(false);
    }
  }

  async function cancelCurrentRun() {
    const context = [...runContexts.current.values()].find((item) => item.localThreadId === activeThread?.id);
    if (!context?.threadId || !context?.turnId) return;
    try { await api.agent.interrupt({ agentId: context.agentId, runId: context.runId, threadId: context.threadId, turnId: context.turnId }); }
    catch (error) { notify(String(error.message || error)); }
  }

  async function respondToApproval({ approvalId, approved, optionId }) {
    const decision = approved ? (optionId === "allow-session" ? "acceptForSession" : "accept") : "decline";
    await api.agent.respondToApproval({ approvalId, decision });
    setMessages((current) => {
      const next = { ...current };
      for (const threadId of Object.keys(next)) next[threadId] = next[threadId].map((message) => ({ ...message, parts: message.parts?.map((part) => part.approval?.id === approvalId ? { ...part, approval: { ...part.approval, approved, optionId } } : part) }));
      return next;
    });
  }

  async function startTerminal() {
    if (!activeProject || terminalOpen) return;
    setTerminalOutput("正在启动终端…\n"); setTerminalOpen(true);
    try { await api.terminal.start(activeProject.id); } catch (error) { setTerminalOutput(`${error.message || error}\n`); }
  }
  async function closeTerminal() { if (terminalOpen && api) await api.terminal.stop().catch(() => {}); setTerminalOpen(false); }
  async function closeBottomPanel() { await closeTerminal(); setBottomPanelOpen(false); }
  async function toggleBottomPanel() {
    if (bottomPanelOpen) { await closeBottomPanel(); return; }
    setBottomPanelOpen(true);
    if (activeTool === "terminal") await startTerminal();
  }
  async function selectWorkspaceTool(tool) {
    const definition = workspaceTools.find((item) => item.id === tool);
    if (definition?.projectOnly && !activeProject) { notify("请先选择一个项目会话"); return; }
    setActiveTool(tool); setBottomPanelOpen(true);
    if (tool === "terminal") await startTerminal();
    if (tool === "review" && activeProject) await refreshGit(activeProject.id);
    if (tool === "files" && activeProject) api.files.list(activeProject.id).then(setProjectFiles).catch((error) => notify(String(error.message || error)));
    if (tool === "browser" && activeProject) api.git.remote(activeProject.id).then(setRemoteUrl).catch(() => setRemoteUrl(""));
  }
  async function runTerminalCommand() { const command = terminalCommand.trim(); if (!command) return; setTerminalOutput((current) => `${current}$ ${command}\n`); setTerminalCommand(""); try { await api.terminal.write(command); window.setTimeout(() => refreshGit(), 500); } catch (error) { setTerminalOutput((current) => `${current}${error.message || error}\n`); } }

  async function sendSideChat() {
    const prompt = sideValue.trim(); if (!prompt || sideSending) return;
    const userMessage = { id: crypto.randomUUID(), role: "user", text: prompt };
    setSideMessages((current) => [...current, userMessage]); setSideValue(""); setSideSending(true);
    try {
      const result = await api.agent.send({ projectId: activeProject?.id, prompt, model: settings.model, reasoning: settings.reasoning, sandboxMode: settings.sandboxMode, threadId: sideThreadId || undefined });
      setSideMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: result.text }]);
      if (result.threadId) setSideThreadId(result.threadId);
    } catch (error) { setSideMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: String(error.message || error) }]); }
    finally { setSideSending(false); }
  }

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
  async function saveProvider(input) { const saved = await api.providers.save(input); setProviderStore(await api.providers.list()); return saved; }
  async function removeProvider(id) { const store = await api.providers.remove(id); setProviderStore(store); return store; }
  async function setActiveProvider(id) { await api.providers.setActive(id); const store = await api.providers.list(); setProviderStore(store); return store; }

  async function selectModel(model) {
    try {
      const supported = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
      const reasoning = supported.includes(activePreference.reasoning) ? activePreference.reasoning : model.defaultReasoningEffort;
      if (selectedAgent === "codex") {
        await saveSettings({ model: model.model, reasoning });
        setAgentPreferences((current) => ({ ...current, codex: { model: model.model, reasoning } }));
      } else {
        setAgentPreferences((current) => ({ ...current, [selectedAgent]: { model: model.model, reasoning } }));
      }
      setModelOpen(null);
      notify(`已切换到 ${model.displayName}`);
    } catch (error) { notify(String(error.message || error)); }
  }

  async function selectReasoning(reasoning) {
    try {
      if (selectedAgent === "codex") {
        await saveSettings({ reasoning });
        setAgentPreferences((current) => ({ ...current, codex: { ...current.codex, reasoning } }));
      } else {
        setAgentPreferences((current) => ({ ...current, [selectedAgent]: { ...current[selectedAgent], reasoning } }));
      }
      setModelOpen(null);
      notify(`思考程度已切换为${reasoningLabels[reasoning] || reasoning}`);
    } catch (error) { notify(String(error.message || error)); }
  }

  if (fatalError) return <div className="fatal-screen"><WarningCircle size={32} /><h1>Rux 无法启动</h1><p>{fatalError}</p></div>;
  if (!activeThread) return <div className="fatal-screen"><CircleNotch size={30} className="spin" /><p>正在加载工作区…</p></div>;
  if (view === "settings") return <div className="app-frame"><SettingsScreen settings={settings} auth={auth} models={models} agents={agents} modelsByAgent={modelsByAgent} providerStore={providerStore} onProviderSave={saveProvider} onProviderRemove={removeProvider} onProviderSetActive={setActiveProvider} onProviderTest={(id) => api.providers.test(id)} systemInfo={systemInfo} projectCount={workspace.projects.length} activeProject={activeProject} gitState={gitState} onBack={() => setView(isStandalone ? "standalone" : "project")} onSave={saveSettings} onTest={testSettings} onLogin={async () => { await api.auth.login(); setTimeout(async () => setAuth(await api.auth.status()), 1500); }} onLogout={async () => { await api.auth.logout(); setAuth(await api.auth.status()); return "已退出"; }} onNotify={notify} />{toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={18} />{toast}</div>}</div>;

  const composerProps = { settings: activeComposerSettings, auth, models: activeModels, modelsLoading, modelsError, modelOpen, sandboxOpen, attachments, listening, onToggleModel: (menu) => { setModelOpen((open) => open === menu ? null : menu); setSandboxOpen(false); }, onSelectModel: selectModel, onSelectReasoning: selectReasoning, onToggleSandbox: () => { setSandboxOpen((open) => !open); setModelOpen(null); }, onSelectSandbox: selectSandbox, onPermissionInfo: () => notify("可在设置 > 权限中修改默认批准方式"), onAddFiles: addFiles, onRemoveAttachment: (path) => setAttachments((current) => current.filter((item) => item !== path)), onVoice: toggleVoice, onAssociateProject: () => { const project = workspace.projects[0]; const thread = project?.threads[0]; if (project && thread) selectProjectThread(project, thread); else if (project) newProjectThread(project); }, value: composerValue, onChange: setComposerValue, onSend: sendMessage, sending };
  const assistantProps = {
    messages: activeMessages,
    running: sending,
    onNewMessage: sendMessage,
    onCancel: cancelCurrentRun,
    onApproval: respondToApproval,
    agents,
    runtimeProgress,
    selectedAgent,
    onSelectAgent: async (agentId) => {
      const agent = agents.find((item) => item.id === agentId);
      if (!agent?.integrated) { notify(`${agent?.name || agentId} 适配器尚未启用`); return; }
      if (agentId === selectedAgent) return;
      const boundAgent = activeThread.agentId || (activeThread.codexThreadId ? "codex" : null);
      if (activeMessages.length || (boundAgent && boundAgent !== agentId) || activeThread.nativeSessionId) {
        if (!window.confirm(`当前会话已绑定 ${agents.find((item) => item.id === selectedAgent)?.name || selectedAgent}。\n\n切换到 ${agent.name} 将新建一个空白 Rux 会话，当前会话会保留。`)) return;
        if (activeProject) {
          const thread = await api.projects.addThread({ projectId: activeProject.id, title: `未命名 ${agent.name} 会话` });
          await reloadWorkspace();
          selectProjectThread(activeProject, { ...thread, agentId });
        } else {
          const thread = await api.projects.addStandalone({ title: `未命名 ${agent.name} 会话` });
          await reloadWorkspace();
          selectStandalone({ ...thread, agentId });
        }
      }
      setSelectedAgent(agentId);
      setAgentMode(agent.modes?.[0]?.id || "default");
    },
    agentMode,
    onAgentMode: setAgentMode,
    modelLabel: modelDisplayName(activeComposerSettings, activeModels),
    reasoningLabel: reasoningLabels[activePreference.reasoning] || activePreference.reasoning,
    permissionLabel: sandboxLabels[settings.sandboxMode] || "帮我批准",
    showPermission: selectedAgent === "codex",
    modelOpen,
    sandboxOpen,
    modelPopover: <ModelPopover mode={modelOpen} settings={activeComposerSettings} auth={auth} models={activeModels} loading={modelsLoading} error={modelsError} onSelectModel={selectModel} onSelectReasoning={selectReasoning} connectionLabel={selectedAgent === "claude-code" ? `${modelDisplayName(activeComposerSettings, activeModels)} · Claude Code` : undefined} />,
    permissionPopover: <PermissionPopover selectedValue={settings.sandboxMode} onSelect={selectSandbox} onLearnMore={() => notify("可在设置 > 权限中修改默认批准方式")} />,
    onToggleModel: composerProps.onToggleModel,
    onToggleSandbox: composerProps.onToggleSandbox,
    attachments,
    onAddFiles: addFiles,
    onRemoveAttachment: composerProps.onRemoveAttachment,
    listening,
    onVoice: toggleVoice,
  };
  return (
    <div className="app-frame">
      <Sidebar workspace={workspace} auth={auth} expandedProjects={expandedProjects} activeThread={activeThread} onToggleProject={(projectId) => setExpandedProjects((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])} onSelectProjectThread={selectProjectThread} onSelectStandalone={selectStandalone} onAddProject={() => setModalStep("choose")} onRemoveProject={removeProject} onOpenProjectPath={(project) => api.system.openPath(project.id).catch((error) => notify(String(error.message || error)))} onCopyProjectPath={(project) => api.system.copy(project.path).then(() => notify("项目路径已复制"))} onNewProjectThread={newProjectThread} onNewStandalone={newStandalone} onOpenSettings={() => setView("settings")} />
      <main className="app-stage">
        <TopBar activeThread={activeThread} bottomPanelOpen={bottomPanelOpen} rightPanelOpen={rightPanelOpen} onToggleBottomPanel={toggleBottomPanel} onToggleRightPanel={() => setRightPanelOpen((open) => !open)} onOpenSettings={() => setView("settings")} onOpenPath={() => activeProject && api.system.openPath(activeProject.id).catch((error) => notify(String(error.message || error)))} onCopyPath={() => activeProject && api.system.copy(activeProject.path).then(() => notify("项目路径已复制"))} onShare={copyConversation} onRename={renameActiveThread} onRemoveThread={removeActiveThread} />
        <div className={`stage-body ${bottomPanelOpen ? "bottom-panel-is-open" : ""}`}>
          <div className="work-pane">
            <div className="main-content">{view === "review" ? <ReviewScreen gitState={gitState} selectedFile={selectedFile} diff={diff} onSelectFile={selectDiff} onBack={() => setView("project")} onStageAll={() => stage(gitState.files.map((file) => file.path))} onStageFile={() => stage([selectedFile])} onDiscard={discardSelected} busy={busy} /> : <ConversationScreen standalone={isStandalone} activeThread={activeThread} assistantProps={assistantProps} gitState={gitState} onReview={openReview} />}</div>
            {rightPanelOpen && <ToolLauncher activeTool={bottomPanelOpen ? activeTool : ""} hasProject={Boolean(activeProject)} onSelectTool={selectWorkspaceTool} />}
          </div>
          {bottomPanelOpen && <WorkspaceDock activeTool={activeTool} hasProject={Boolean(activeProject)} gitState={gitState} terminalProps={{ output: terminalOutput, command: terminalCommand, onCommandChange: setTerminalCommand, onRun: runTerminalCommand, onClose: closeBottomPanel, projectName: activeProject?.name || "终端", embedded: true }} remoteUrl={remoteUrl} projectFiles={projectFiles} sideMessages={sideMessages} sideValue={sideValue} sideSending={sideSending} onSelectTool={selectWorkspaceTool} onClose={closeBottomPanel} onOpenReview={() => { setView("review"); setBottomPanelOpen(false); }} onOpenRemote={openRemote} onOpenFile={(path) => activeProject && api.files.open({ projectId: activeProject.id, path }).catch((error) => notify(String(error.message || error)))} onSideValue={setSideValue} onSendSide={sendSideChat} />}
        </div>
      </main>
      {modalStep && <AddProjectModal step={modalStep} defaultParent={defaultParent} onClose={() => setModalStep(null)} onStep={setModalStep} onComplete={completeProjectAction} />}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={18} />{toast}</div>}
    </div>
  );
}

export default App;
