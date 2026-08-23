import { useMemo, useState } from "react";
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
  X,
} from "@phosphor-icons/react";

const standaloneThreads = [
  { id: "compare", title: "比较模型响应" },
  { id: "logs", title: "解释错误日志" },
];

const initialProjects = [
  {
    id: "rux",
    name: "rux",
    threads: [
      { id: "design", title: "设计 Rux Agent 桌面端 UI" },
      { id: "providers", title: "实现模型连接设置" },
    ],
  },
  { id: "job-seeker", name: "job-seeker-agent", threads: [] },
  { id: "jiali", name: "jiali", threads: [] },
];

const changedFiles = [
  { name: "src/settings/providers.ts", plus: 128, minus: 12 },
  { name: "src/App.jsx", plus: 8, minus: 2 },
  { name: "src/styles.css", plus: 10, minus: 8 },
];

function IconButton({ label, children, active = false, onClick, className = "" }) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Sidebar({
  projects,
  expandedProjects,
  activeThread,
  onToggleProject,
  onSelectProjectThread,
  onSelectStandalone,
  onAddProject,
  onNewProjectThread,
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
            <IconButton label="新建独立会话"><Plus size={17} /></IconButton>
          </div>
          <div className="sidebar-list">
            {standaloneThreads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                className={`sidebar-row ${activeThread.type === "standalone" && activeThread.id === thread.id ? "is-selected" : ""}`}
                onClick={() => onSelectStandalone(thread)}
              >
                <ChatCircle size={17} />
                <span>{thread.title}</span>
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
                  <button
                    type="button"
                    className="project-row"
                    onClick={() => onToggleProject(project.id)}
                  >
                    {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    <Folder size={18} />
                    <span>{project.name}</span>
                  </button>
                  {expanded && (
                    <div className="thread-children">
                      {project.threads.map((thread) => (
                        <button
                          type="button"
                          className={`sidebar-row child-row ${activeThread.type === "project" && activeThread.id === thread.id ? "is-selected" : ""}`}
                          key={thread.id}
                          onClick={() => onSelectProjectThread(project, thread)}
                        >
                          <ChatCircle size={16} />
                          <span>{thread.title}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="sidebar-row child-row new-thread-row"
                        onClick={() => onNewProjectThread(project)}
                      >
                        <Plus size={16} />
                        <span>新建项目会话</span>
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
        <span className="avatar avatar-small">S</span>
        <span>SuperZ</span>
        <CaretDown size={15} />
      </button>
    </aside>
  );
}

function TopBar({ activeThread, onToggleRightPanel, rightPanelOpen, onOpenSettings }) {
  const isProject = activeThread.type === "project";
  return (
    <header className="topbar">
      <div className="topbar-title">
        {isProject ? <Folder size={19} /> : <ChatCircle size={19} />}
        {isProject && <span className="muted-title">{activeThread.projectName}</span>}
        {isProject && <span className="title-separator">/</span>}
        <strong>{activeThread.title}</strong>
        {!isProject && <span className="standalone-badge">独立会话</span>}
        <IconButton label="更多"><DotsThree size={20} /></IconButton>
      </div>
      <div className="topbar-actions">
        <IconButton label="分享"><ShareNetwork size={18} /></IconButton>
        {isProject && (
          <button type="button" className="toolbar-button">
            <span>打开位置</span><CaretDown size={14} />
          </button>
        )}
        <IconButton label="切换侧边面板" active={rightPanelOpen} onClick={onToggleRightPanel}>
          <SidebarSimple size={19} />
        </IconButton>
        <IconButton label="设置" onClick={onOpenSettings}><GearSix size={18} /></IconButton>
      </div>
    </header>
  );
}

function EnvironmentPanel({ onReview }) {
  return (
    <aside className="environment-panel">
      <div className="panel-heading">
        <span>环境信息</span>
        <Plus size={17} />
      </div>
      <button type="button" className="environment-row" onClick={onReview}>
        <FileText size={18} />
        <strong>变更</strong>
        <span className="change-count"><b>+128</b> <em>−12</em></span>
      </button>
      <div className="environment-row">
        <Monitor size={18} />
        <strong>本地</strong>
      </div>
      <div className="environment-row">
        <GitBranch size={18} />
        <span>main</span>
        <CaretDown size={15} className="row-end" />
      </div>
      <div className="environment-row is-disabled">
        <ArrowUp size={18} />
        <span>提交或推送</span>
      </div>
      <button type="button" className="environment-row">
        <GitBranch size={18} />
        <strong>比较分支</strong>
        <ArrowSquareOut size={15} className="row-end" />
      </button>
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

function Composer({ standalone = false, modelOpen, onToggleModel, onAssociateProject }) {
  return (
    <div className="composer-wrap">
      {modelOpen && <ModelPopover />}
      <div className="composer">
        <textarea aria-label="消息" placeholder="向 Rux 发送消息" rows={2} />
        <div className="composer-controls">
          <div className="composer-left">
            <IconButton label="添加上下文"><Plus size={20} /></IconButton>
            {standalone ? (
              <>
                <button type="button" className="scope-button neutral"><FolderOpen size={17} />未关联项目<CaretDown size={13} /></button>
                <button type="button" className="text-action" onClick={onAssociateProject}>关联到项目</button>
              </>
            ) : (
              <button type="button" className="scope-button"><ShieldCheck size={17} />完全访问<CaretDown size={13} /></button>
            )}
          </div>
          <div className="composer-right">
            <button type="button" className="composer-menu" onClick={onToggleModel}>gpt-5.4<CaretDown size={13} /></button>
            <button type="button" className="composer-menu">高<CaretDown size={13} /></button>
            <IconButton label="语音输入"><Microphone size={19} /></IconButton>
            <button type="button" className="send-button" aria-label="发送"><ArrowUp size={20} weight="bold" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelPopover() {
  return (
    <div className="model-popover">
      <div className="popover-heading"><strong>会话设置</strong><span className="status-dot" /></div>
      <div className="popover-row"><span>连接</span><strong>GPT OAuth</strong><span className="connected">已连接</span></div>
      <div className="popover-row"><span>模型</span><strong>gpt-5.4</strong><CaretRight size={14} /></div>
      <div className="popover-row"><span>思考程度</span><strong>高</strong><CaretRight size={14} /></div>
      <div className="popover-footer">在“模型与连接”中管理服务</div>
    </div>
  );
}

function ProgressList() {
  return (
    <div className="progress-list">
      <div className="progress-item done"><Check size={14} weight="bold" /><span>检查现有配置</span></div>
      <div className="progress-line" />
      <div className="progress-item done"><Check size={14} weight="bold" /><span>设计连接数据结构</span></div>
      <div className="progress-line" />
      <div className="progress-item running"><CircleNotch size={16} /><span>实现设置界面</span></div>
    </div>
  );
}

function ProjectConversation({ onReview, modelOpen, onToggleModel, terminalOpen, onToggleTerminal }) {
  return (
    <div className="conversation-screen">
      <div className="conversation-scroll">
        <div className="message user-message">
          <span className="avatar">S</span>
          <div className="message-bubble">支持 GPT OAuth 和自定义 Base URL，并允许选择模型与思考程度。</div>
        </div>
        <div className="message agent-message">
          <span className="avatar avatar-dark">R</span>
          <div className="agent-copy">
            <p>好的，我来实现模型连接设置，支持 GPT OAuth、自定义 Base URL，并允许选择模型与思考程度。</p>
            <ProgressList />
            <button type="button" className="command-row"><TerminalWindow size={18} /><code>pnpm test</code><CaretDown size={15} /></button>
            <div className="result-summary">
              <div className="result-title"><FileText size={19} /><strong>已更新 3 个文件</strong></div>
              <ul>
                {changedFiles.map((file) => <li key={file.name}><File size={15} /><span>{file.name}</span></li>)}
              </ul>
              <button type="button" className="secondary-button" onClick={onReview}><Eye size={17} />审查变更</button>
            </div>
          </div>
        </div>
      </div>
      <Composer modelOpen={modelOpen} onToggleModel={onToggleModel} />
      <button type="button" className={`terminal-toggle ${terminalOpen ? "is-open" : ""}`} onClick={onToggleTerminal}>
        <span><TerminalWindow size={18} />终端</span>
        {terminalOpen ? <CaretDown size={15} /> : <CaretRight size={15} />}
      </button>
    </div>
  );
}

function StandaloneConversation({ modelOpen, onToggleModel, onAssociateProject }) {
  return (
    <div className="conversation-screen standalone-screen">
      <div className="conversation-scroll">
        <div className="message user-message">
          <span className="avatar">S</span>
          <div className="message-bubble">比较两种实现重试队列的方案，并说明取舍。</div>
        </div>
        <div className="message agent-message">
          <span className="avatar avatar-dark">R</span>
          <div className="agent-copy comparison-copy">
            <h3>Rux</h3>
            <p>以下比较两种实现重试队列的常见方案及其取舍：</p>
            <div className="comparison-table">
              <div className="comparison-head"><span /> <strong>方案 A：内存队列</strong><strong>方案 B：持久化队列</strong></div>
              {[
                ["可靠性", "进程重启或崩溃会丢失队列数据", "数据持久化，重启后可恢复"],
                ["持久化", "无，需要外部持久化机制", "内置持久化（磁盘 / 数据库 / 日志）"],
                ["性能", "高，内存操作开销低", "中等，有 I/O 开销"],
                ["复杂度", "低，易于实现", "中等，需要处理恢复逻辑"],
                ["适用场景", "临时任务、可容忍少量丢失", "关键任务、需要保证不丢失"],
              ].map((row) => (
                <div className="comparison-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span></div>
              ))}
            </div>
            <div className="recommendation"><strong>建议：</strong>桌面代理默认使用持久化队列</div>
          </div>
        </div>
      </div>
      <Composer standalone modelOpen={modelOpen} onToggleModel={onToggleModel} onAssociateProject={onAssociateProject} />
    </div>
  );
}

function TerminalPanel({ onClose }) {
  return (
    <section className="terminal-panel">
      <div className="terminal-tabs">
        <div className="terminal-tab"><TerminalWindow size={17} /><span>17a@Mac · rux</span><X size={14} /></div>
        <IconButton label="新建终端"><Plus size={18} /></IconButton>
        <IconButton label="关闭终端" className="terminal-close" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="terminal-body" aria-label="终端输出">
        <p><span className="prompt-arrow">➜</span> <span className="prompt-project">rux</span> <span className="prompt-git">git:(main)</span></p>
        <p><span className="prompt-symbol">$</span> pnpm test</p>
        <p className="terminal-success">✓ 24 tests passed</p>
        <p><span className="prompt-symbol">$</span> <span className="terminal-cursor" /></p>
      </div>
    </section>
  );
}

function ReviewScreen({ onBack, onApplied }) {
  const [selectedFile, setSelectedFile] = useState(changedFiles[0].name);
  return (
    <div className="review-screen">
      <div className="review-tabs"><button type="button" onClick={onBack}>对话</button><button type="button" className="is-active">变更 <span>3</span></button></div>
      <div className="review-summary"><span><FileText size={18} />3 个文件已更改</span><span className="tests-passed"><CheckCircle size={19} />测试通过</span><div className="review-nav"><button type="button"><CaretLeft size={15} />上一个</button><button type="button">下一个<CaretRight size={15} /></button></div></div>
      <div className="review-workspace">
        <div className="file-list">
          {changedFiles.map((file) => (
            <button type="button" key={file.name} className={selectedFile === file.name ? "is-selected" : ""} onClick={() => setSelectedFile(file.name)}>
              <File size={17} /><span>{file.name}</span><small><b>+{file.plus}</b> <em>−{file.minus}</em></small>
            </button>
          ))}
        </div>
        <DiffViewer file={selectedFile} />
      </div>
      <div className="review-actions">
        <button type="button" className="primary-button" onClick={onApplied}>全部应用</button>
        <button type="button" className="secondary-button" onClick={onApplied}>逐个应用</button>
        <button type="button" className="danger-link">放弃更改</button>
        <button type="button" className="back-to-chat" onClick={onBack}><ArrowLeft size={16} />返回对话</button>
      </div>
    </div>
  );
}

function DiffViewer({ file }) {
  const before = ["export type Provider = {", "  id: string;", "  name: string;", "  type: 'openai' | 'custom';", "  apiKey: string;", "  baseUrl?: string;", "};", "", "export const defaultProviders = []"];
  const after = ["export type Provider = {", "  id: string;", "  name: string;", "  type: 'oauth' | 'custom';", "  apiKey?: string;", "  baseUrl?: string;", "  models?: string[];", "  defaultModel?: string;", "};"];
  return (
    <div className="diff-viewer">
      <div className="diff-heading">{file}</div>
      <div className="diff-meta">@@ −1,9 +1,9 @@</div>
      <div className="diff-columns">
        <div className="diff-column removed">{before.map((line, i) => <div key={`${line}-${i}`}><span>{i + 1}</span><code>− {line}</code></div>)}</div>
        <div className="diff-column added">{after.map((line, i) => <div key={`${line}-${i}`}><span>{i + 1}</span><code>+ {line}</code></div>)}</div>
      </div>
    </div>
  );
}

function AddProjectModal({ step, onClose, onStep, onComplete }) {
  const [choice, setChoice] = useState("import");
  const [importMode, setImportMode] = useState("folder");
  const [projectName, setProjectName] = useState("rux-agent");
  const [template, setTemplate] = useState("empty");
  const [gitEnabled, setGitEnabled] = useState(true);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal ${step === "choose" ? "choice-modal" : "form-modal"}`} role="dialog" aria-modal="true" aria-label="添加项目">
        {step === "choose" && (
          <>
            <ModalHeader title="添加项目" subtitle="导入现有代码，或从零开始创建" onClose={onClose} />
            <div className="choice-list">
              <button type="button" className={`project-choice ${choice === "import" ? "is-selected" : ""}`} onClick={() => setChoice("import")}>
                <span className="choice-icon"><DownloadSimple size={26} /></span><span><strong>导入已有项目</strong><small>选择本地文件夹或克隆 Git 仓库</small></span><span className="radio-mark">{choice === "import" && <span />}</span>
              </button>
              <button type="button" className={`project-choice ${choice === "create" ? "is-selected" : ""}`} onClick={() => setChoice("create")}>
                <span className="choice-icon"><FolderPlus size={27} /></span><span><strong>新建项目</strong><small>创建空项目或从模板开始</small></span><span className="radio-mark">{choice === "create" && <span />}</span>
              </button>
            </div>
            <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><span className="keyboard-hint">按 ↵ 继续</span><button type="button" className="primary-button" onClick={() => onStep(choice)}>继续</button></div>
          </>
        )}

        {step === "import" && (
          <>
            <ModalHeader title="导入已有项目" subtitle="选择本地文件夹，或从 Git 仓库克隆" onBack={() => onStep("choose")} onClose={onClose} />
            <div className="segmented-control"><button type="button" className={importMode === "folder" ? "is-active" : ""} onClick={() => setImportMode("folder")}>本地文件夹</button><button type="button" className={importMode === "git" ? "is-active" : ""} onClick={() => setImportMode("git")}>Git 仓库</button></div>
            {importMode === "folder" ? (
              <div className="form-stack">
                <label className="form-row"><span><strong>项目文件夹</strong><small>~/Projects/rux</small></span><button type="button" className="secondary-button">选择文件夹</button></label>
                <div className="detected-project"><Folder size={30} /><span><strong>rux</strong><small>Git 仓库 · main 分支</small></span><span className="import-ok"><CheckCircle size={18} />可以导入</span></div>
              </div>
            ) : (
              <div className="form-stack"><label className="field-label">Git 仓库地址<input defaultValue="https://github.com/example/rux.git" /></label><label className="field-label">保存位置<input defaultValue="~/Projects" /></label></div>
            )}
            <label className="checkbox-row"><input type="checkbox" defaultChecked /><span>导入后创建首个项目会话</span></label>
            <p className="form-note">项目文件不会被移动</p>
            <div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onStep("choose")}>上一步</button><button type="button" className="primary-button" onClick={() => onComplete("项目已导入")}>导入项目</button></div>
          </>
        )}

        {step === "create" && (
          <>
            <ModalHeader title="新建项目" subtitle="创建一个新的本地项目" onBack={() => onStep("choose")} onClose={onClose} />
            <div className="form-stack create-form">
              <label className="field-label">项目名称<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
              <label className="form-row"><span><strong>保存位置</strong><small>~/Projects</small></span><button type="button" className="secondary-button">选择位置</button></label>
              <fieldset className="template-fieldset"><legend>起始模板</legend><div className="template-options">{[["empty", "空项目", <Folder key="folder" size={19} />], ["react", "React", <Code key="react" size={19} />], ["node", "Node.js", <TerminalWindow key="node" size={19} />]].map(([id, title, icon]) => <button type="button" key={id} className={template === id ? "is-selected" : ""} onClick={() => setTemplate(id)}><span className="radio-mark">{template === id && <span />}</span>{icon}{title}</button>)}</div></fieldset>
              <label className="toggle-row"><span>初始化 Git 仓库</span><input type="checkbox" checked={gitEnabled} onChange={(event) => setGitEnabled(event.target.checked)} /><span className="toggle-control" /></label>
              <div className="path-preview">~/Projects/{projectName || "新项目"}</div>
            </div>
            <label className="checkbox-row"><input type="checkbox" defaultChecked /><span>创建后新建项目会话</span></label>
            <div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onStep("choose")}>上一步</button><button type="button" className="primary-button" onClick={() => onComplete("项目已创建")}>创建项目</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function ModalHeader({ title, subtitle, onBack, onClose }) {
  return (
    <div className="modal-header">
      <div className="modal-title-row">{onBack && <IconButton label="返回" onClick={onBack}><ArrowLeft size={20} /></IconButton>}<h2>{title}</h2><IconButton label="关闭" className="modal-close" onClick={onClose}><X size={20} /></IconButton></div>
      <p>{subtitle}</p>
    </div>
  );
}

function SettingsScreen({ onBack, onNotify }) {
  const [oauthConnected, setOauthConnected] = useState(true);
  const [reasoning, setReasoning] = useState("高");
  const [allowOverride, setAllowOverride] = useState(true);
  const [baseUrl, setBaseUrl] = useState("https://api.example.com/v1");
  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={18} />返回 Rux</button>
        <label className="settings-search"><MagnifyingGlass size={18} /><input placeholder="搜索设置…" /></label>
        <nav>
          <button type="button"><GearSix size={19} />常规</button>
          <button type="button"><Palette size={19} />外观</button>
          <button type="button"><LockKey size={19} />权限</button>
          <button type="button" className="is-active"><SlidersHorizontal size={19} />模型与连接</button>
          <button type="button"><Keyboard size={19} />键盘快捷键</button>
          <button type="button"><GitBranch size={19} />Git</button>
          <button type="button"><Monitor size={19} />环境</button>
        </nav>
      </aside>
      <main className="settings-content">
        <h1>模型与连接</h1>
        <section className="settings-section">
          <h2>GPT OAuth</h2>
          <div className="settings-group oauth-group">
            <div className="settings-row provider-row"><div className="provider-mark"><CircleNotch size={24} /></div><strong>OpenAI</strong>{oauthConnected ? <span className="connected-badge">已连接</span> : <span className="disconnected-badge">未连接</span>}<span className="provider-email">superz@example.com</span><button type="button" className="secondary-button" onClick={() => { setOauthConnected(true); onNotify("OAuth 登录状态已刷新"); }}>重新登录</button></div>
            <button type="button" className="danger-link disconnect-link" onClick={() => setOauthConnected(false)}>断开连接</button>
          </div>
        </section>
        <section className="settings-section">
          <h2>自定义服务</h2>
          <div className="settings-group form-settings">
            <label className="settings-row"><span>服务名称</span><input defaultValue="OpenAI Compatible" /></label>
            <label className="settings-row"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" defaultValue="sk-example-key" /><Eye size={18} /></span></label>
            <div className="settings-row settings-actions"><button type="button" className="secondary-button" onClick={() => onNotify("连接成功")}>测试连接</button><span className="connected">连接成功</span><button type="button" className="primary-button" onClick={() => onNotify("自定义服务已保存")}>保存服务</button></div>
          </div>
        </section>
        <section className="settings-section">
          <h2>默认模型</h2>
          <div className="settings-group form-settings">
            <div className="settings-row"><span>模型</span><button type="button" className="select-control">gpt-5.4<CaretDown size={14} /></button><button type="button" className="secondary-button"><ArrowsClockwise size={16} />刷新模型列表</button></div>
            <div className="settings-row"><span>思考程度</span><div className="reasoning-control">{["低", "中", "高", "极高"].map((level) => <button type="button" key={level} className={reasoning === level ? "is-selected" : ""} onClick={() => setReasoning(level)}>{level}</button>)}</div></div>
            <label className="settings-row toggle-setting"><span>允许会话覆盖默认设置</span><input type="checkbox" checked={allowOverride} onChange={(event) => setAllowOverride(event.target.checked)} /><span className="toggle-control" /></label>
          </div>
          <p className="settings-help">项目会话和独立会话都可以单独选择模型与思考程度。</p>
        </section>
      </main>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState(initialProjects);
  const [expandedProjects, setExpandedProjects] = useState(["rux"]);
  const [activeThread, setActiveThread] = useState({ type: "project", id: "providers", title: "实现模型连接设置", projectId: "rux", projectName: "rux" });
  const [view, setView] = useState("project");
  const [modalStep, setModalStep] = useState(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [toast, setToast] = useState("");

  const isStandalone = activeThread.type === "standalone";
  const showEnvironment = !isStandalone && rightPanelOpen && !terminalOpen;
  const showToolLauncher = !isStandalone && rightPanelOpen && terminalOpen && view === "project";

  function notify(message) {
    setToast(message);
    window.clearTimeout(window.__ruxToastTimer);
    window.__ruxToastTimer = window.setTimeout(() => setToast(""), 2600);
  }

  function selectProjectThread(project, thread) {
    setActiveThread({ type: "project", id: thread.id, title: thread.title, projectId: project.id, projectName: project.name });
    setView("project");
    setTerminalOpen(false);
    setModelOpen(false);
  }

  function selectStandalone(thread) {
    setActiveThread({ type: "standalone", id: thread.id, title: thread.title });
    setView("standalone");
    setTerminalOpen(false);
    setRightPanelOpen(true);
    setModelOpen(false);
  }

  function newProjectThread(project) {
    const newThread = { id: `thread-${Date.now()}`, title: "未命名会话" };
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, threads: [...item.threads, newThread] } : item));
    selectProjectThread(project, newThread);
  }

  function completeProjectAction(message) {
    setModalStep(null);
    notify(message);
  }

  const activeProjectTitle = useMemo(() => activeThread.type === "project" ? activeThread.title : "实现模型连接设置", [activeThread]);

  if (view === "settings") {
    return <div className="app-frame"><SettingsScreen onBack={() => setView(activeThread.type === "standalone" ? "standalone" : "project")} onNotify={notify} />{toast && <div className="toast"><CheckCircle size={18} />{toast}</div>}</div>;
  }

  return (
    <div className="app-frame">
      <Sidebar
        projects={projects}
        expandedProjects={expandedProjects}
        activeThread={activeThread}
        onToggleProject={(projectId) => setExpandedProjects((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId])}
        onSelectProjectThread={selectProjectThread}
        onSelectStandalone={selectStandalone}
        onAddProject={() => setModalStep("choose")}
        onNewProjectThread={newProjectThread}
        onOpenSettings={() => setView("settings")}
      />
      <main className="app-stage">
        <TopBar activeThread={activeThread} onToggleRightPanel={() => setRightPanelOpen((open) => !open)} rightPanelOpen={rightPanelOpen} onOpenSettings={() => setView("settings")} />
        <div className={`stage-body ${terminalOpen ? "terminal-is-open" : ""}`}>
          <div className="work-pane">
            <div className="main-content">
              {view === "review" ? (
                <ReviewScreen onBack={() => setView("project")} onApplied={() => { setView("project"); notify("变更已应用"); }} />
              ) : isStandalone ? (
                <StandaloneConversation modelOpen={modelOpen} onToggleModel={() => setModelOpen((open) => !open)} onAssociateProject={() => { setActiveThread({ type: "project", id: "providers", title: activeProjectTitle, projectId: "rux", projectName: "rux" }); setView("project"); notify("会话已关联到 rux"); }} />
              ) : (
                <ProjectConversation onReview={() => setView("review")} modelOpen={modelOpen} onToggleModel={() => setModelOpen((open) => !open)} terminalOpen={terminalOpen} onToggleTerminal={() => setTerminalOpen((open) => !open)} />
              )}
            </div>
            {showEnvironment && <EnvironmentPanel onReview={() => setView("review")} />}
            {showToolLauncher && <ToolLauncher />}
            {isStandalone && rightPanelOpen && <UtilityPanel />}
          </div>
          {terminalOpen && view === "project" && <TerminalPanel onClose={() => setTerminalOpen(false)} />}
        </div>
      </main>
      {modalStep && <AddProjectModal step={modalStep} onClose={() => setModalStep(null)} onStep={setModalStep} onComplete={completeProjectAction} />}
      {toast && <div className="toast"><CheckCircle size={18} />{toast}</div>}
    </div>
  );
}

export default App;
