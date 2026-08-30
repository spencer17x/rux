import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ArrowLeft, ArrowsClockwise, Eye, GearSix, GitBranch, Globe, Keyboard,
  LockKey, MagnifyingGlass, Monitor, OpenAiLogo, Palette, Robot, SlidersHorizontal,
} from "@phosphor-icons/react";
import { FullAccessModal } from "../composer/ComposerControls";
import { userFacingError } from "../renderer/errors";

type Reasoning = "none" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type Settings = {
  provider: "codex" | "custom"; serviceName: string; baseUrl: string; hasApiKey: boolean;
  model: string; reasoning: Reasoning; sandboxMode: SandboxMode; uiFontSize: number; conversationSticky: boolean;
};
type Model = { id: string; model: string; displayName: string; isDefault?: boolean; defaultReasoningEffort: Reasoning; supportedReasoningEfforts: Array<{ reasoningEffort: Reasoning }> };
type Agent = { id: string; name: string; managed?: boolean; version?: string; installed?: boolean; integrated?: boolean; path?: string; auth?: { connected?: boolean; authMethod?: string }; modes?: Array<{ id: string; label: string }> };
type ProviderModel = { id: string; name: string; reasoningLevels: string[] };
type ProviderProfile = { id: string; name: string; protocol: "openai-responses" | "openai-chat" | "anthropic-messages" | "ollama"; baseUrl: string; hasApiKey: boolean; headers: Record<string, string>; compatibleAgents: "pi"[]; models: ProviderModel[] };
type ProviderStore = { activeProfileId: string; profiles: ProviderProfile[] };
type Project = { id: string; name: string; path: string };
type GitState = { branch: string; files: unknown[] };
type AuthState = { connected: boolean; message?: string; account?: { email?: string; planType?: string } | null };
type SystemInfo = Record<string, string | undefined>;
type AsyncAction = (...args: any[]) => Promise<any>;

type Props = {
  settings: Settings; auth: AuthState; models: Model[]; modelsLoading: boolean; modelsError: string; agents: Agent[]; modelsByAgent: Record<string, Model[]>;
  providerStore: ProviderStore; systemInfo: SystemInfo; projectCount: number; activeProject: Project | null; gitState: GitState;
  onProviderSave: AsyncAction; onProviderRemove: AsyncAction; onProviderSetActive: AsyncAction; onProviderTest: AsyncAction;
  onBack: () => void; onSave: AsyncAction; onTest: AsyncAction; onLogin: AsyncAction; onLogout: AsyncAction; onNotify: (message: string) => void; permissionChangesLocked?: boolean;
};

const reasoningLabels: Record<string, string> = { none: "无", off: "关闭", minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大", ultra: "Ultra" };
const sandboxLabels: Record<SandboxMode, string> = { "read-only": "请求批准", "workspace-write": "帮我批准", "danger-full-access": "完全访问" };
const emptyProvider: ProviderProfile = { id: "", name: "", protocol: "openai-responses", baseUrl: "", hasApiKey: false, headers: {}, compatibleAgents: ["pi"], models: [] };

function selectedModel(settings: Settings, models: Model[]): Model | undefined {
  return models.find((model) => model.model === settings.model) || models.find((model) => model.isDefault) || models[0];
}

function ProviderProfiles({ store, onSave, onRemove, onSetActive, onTest, onNotify }: { store: ProviderStore; onSave: AsyncAction; onRemove: AsyncAction; onSetActive: AsyncAction; onTest: AsyncAction; onNotify: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(store.activeProfileId || store.profiles[0]?.id || "");
  const [draft, setDraft] = useState<ProviderProfile>(emptyProvider);
  const [apiKey, setApiKey] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  useEffect(() => {
    const profile = store.profiles.find((item) => item.id === selectedId) || store.profiles.find((item) => item.id === store.activeProfileId);
    if (!profile) { setDraft(emptyProvider); setHeadersText(""); setModelsText(""); return; }
    setSelectedId(profile.id); setDraft(profile); setApiKey("");
    setHeadersText(Object.entries(profile.headers || {}).map(([key, value]) => `${key}: ${value}`).join("\n"));
    setModelsText(profile.models.map((model) => `${model.id} | ${model.name || model.id} | ${model.reasoningLevels.join(",")}`).join("\n"));
  }, [selectedId, store.activeProfileId, store.profiles]);
  const update = (patch: Partial<ProviderProfile>) => setDraft((current) => ({ ...current, ...patch }));
  const execute = async (action: () => Promise<string | void>) => { setBusy(true); setStatusError(false); setStatus("正在处理…"); try { setStatus((await action()) || "操作已完成"); } catch (error) { setStatusError(true); setStatus(userFacingError(error)); } finally { setBusy(false); } };
  const parseHeaders = () => Object.fromEntries(headersText.split(/\r?\n/).filter(Boolean).map((line) => { const index = line.indexOf(":"); if (index <= 0) throw new Error(`Header 格式错误：${line}`); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }));
  const parseModels = (): ProviderModel[] => modelsText.split(/\r?\n/).filter(Boolean).map((line) => { const [id, name, levels = ""] = line.split("|").map((part) => part.trim()); return { id, name: name || id, reasoningLevels: levels.split(",").map((value) => value.trim()).filter(Boolean) }; });
  return <div className="provider-settings-layout">
    <aside className="provider-profile-list">
      <button type="button" className="secondary-button provider-add" onClick={() => { setSelectedId(""); setDraft(emptyProvider); setHeadersText(""); setModelsText(""); setApiKey(""); }}>+ 新建 Provider</button>
      {store.profiles.map((profile) => <button type="button" key={profile.id} className={draft.id === profile.id ? "is-selected" : ""} onClick={() => setSelectedId(profile.id)}><span><strong>{profile.name}</strong><small>{profile.protocol} · {profile.models.length} 个模型</small></span>{store.activeProfileId === profile.id && <em>当前</em>}</button>)}
      {!store.profiles.length && <p>尚未配置 Provider</p>}
    </aside>
    <section className="provider-profile-editor"><div className="settings-group form-settings">
      <label className="settings-row"><span>名称</span><input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label className="settings-row"><span>协议</span><select value={draft.protocol} onChange={(event) => update({ protocol: event.target.value as ProviderProfile["protocol"] })}><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option><option value="ollama">Ollama</option></select></label>
      <label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label>
      <label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={draft.hasApiKey ? "已安全保存；留空则不修改" : "输入 API key"} /><Eye size={17} /></span></label>
      <label className="settings-row provider-multiline"><span>自定义 Headers<small>每行 Key: Value</small></span><textarea value={headersText} onChange={(event) => setHeadersText(event.target.value)} /></label>
      <label className="settings-row provider-multiline"><span>模型<small>ID | 显示名称 | reasoning levels</small></span><textarea value={modelsText} onChange={(event) => setModelsText(event.target.value)} /></label>
      <div className="settings-row"><span>兼容运行时</span><div className="provider-agent-checks"><label><input type="checkbox" checked={draft.compatibleAgents.includes("pi")} onChange={(event) => update({ compatibleAgents: event.target.checked ? ["pi"] : [] })} />Pi</label></div></div>
      <div className="settings-row settings-actions provider-actions">
        {draft.id && <button type="button" className="danger-link" disabled={busy} onClick={() => { if (window.confirm(`删除 Provider“${draft.name}”？`)) void execute(async () => { await onRemove(draft.id); setSelectedId(""); return "Provider 已删除"; }); }}>删除</button>}
        {draft.id && <button type="button" className="secondary-button" disabled={busy} onClick={() => void execute(async () => (await onTest(draft.id)).message)}>测试连接</button>}
        {draft.id && store.activeProfileId !== draft.id && <button type="button" className="secondary-button" disabled={busy} onClick={() => void execute(async () => { await onSetActive(draft.id); return "已设为当前 Provider"; })}>设为当前</button>}
        <button type="button" className="primary-button" disabled={busy} onClick={() => void execute(async () => { const saved = await onSave({ ...draft, apiKey, headers: parseHeaders(), models: parseModels() }); setSelectedId(saved.id); setApiKey(""); onNotify("Provider 配置已保存"); return "已安全保存"; })}>保存配置</button>
      </div>
    </div>{status && <p role="status" aria-live="polite" className={`settings-status ${statusError ? "error-text" : busy ? "" : "connected"}`}>{status}</p>}</section>
  </div>;
}

export default function SettingsScreen(props: Props) {
  const { settings, auth, models, modelsLoading, modelsError, agents, modelsByAgent, providerStore, systemInfo, projectCount, activeProject, gitState, onBack, onSave, onTest, onLogin, onLogout, onNotify, permissionChangesLocked = false } = props;
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [section, setSection] = useState("models");
  const [query, setQuery] = useState("");
  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const update = (patch: Partial<Settings>) => setDraft((current) => ({ ...current, ...patch }));
  const model = selectedModel(draft, models);
  const efforts = draft.provider === "codex" && model ? model.supportedReasoningEfforts.map((item) => item.reasoningEffort) : Object.keys(reasoningLabels) as Reasoning[];
  const sections = useMemo<Array<[string, string, ComponentType<{ size?: number }>]>>(() => [["general", "常规", GearSix], ["agents", "底座 Agent", Robot], ["providers", "Provider 配置", Globe], ["appearance", "外观", Palette], ["permissions", "权限", LockKey], ["models", "模型与连接", SlidersHorizontal], ["shortcuts", "键盘快捷键", Keyboard], ["git", "Git", GitBranch], ["environment", "环境", Monitor]], []);
  const visibleSections = sections.filter(([, label]) => !query || label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const execute = async (action: () => Promise<string | void>) => { setBusy(true); setStatusError(false); setStatus("正在处理…"); try { setStatus((await action()) || "操作已完成"); } catch (error) { setStatusError(true); setStatus(userFacingError(error)); } finally { setBusy(false); } };
  const saveDraft = async (message: string) => { await onSave(draft); onNotify(message); return "已保存"; };
  const savePermissions = () => {
    if (permissionChangesLocked) { onNotify("请先停止当前任务；权限变更会从下一轮对话开始生效"); return; }
    if (draft.sandboxMode === "danger-full-access" && settings.sandboxMode !== "danger-full-access") { setFullAccessConfirmOpen(true); return; }
    void execute(() => saveDraft("默认权限已保存"));
  };
  const confirmFullAccess = async () => {
    setBusy(true); setStatusError(false); setStatus("正在启用完整访问权限…");
    try {
      await onSave({ ...draft, sandboxMode: "danger-full-access" });
      setDraft((current) => ({ ...current, sandboxMode: "danger-full-access" }));
      setFullAccessConfirmOpen(false); setStatus("完整访问权限已开启"); onNotify("完整访问权限已开启");
    } catch (error) { const message = userFacingError(error); setStatusError(true); setStatus(message); onNotify(message); }
    finally { setBusy(false); }
  };
  return <div className="settings-shell">
    <aside className="settings-sidebar"><button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={18} />返回 Rux</button><label className="settings-search"><MagnifyingGlass size={18} /><input aria-label="搜索设置" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置…" /></label><nav>{visibleSections.map(([id, label, Icon]) => <button type="button" key={id} aria-current={section === id ? "page" : undefined} className={section === id ? "is-active" : ""} onClick={() => setSection(id)}><Icon size={19} />{label}</button>)}</nav></aside>
    <main className="settings-content"><h1>{sections.find(([id]) => id === section)?.[1] || "设置"}</h1>
      {section === "general" && <><section className="settings-section"><h2>账户</h2><div className="settings-group form-settings"><div className="settings-row"><span>登录账户</span><strong>{auth.account?.email || (auth.connected ? "Codex 已连接" : "未登录")}</strong></div><div className="settings-row"><span>套餐</span><strong>{auth.account?.planType || "—"}</strong></div></div></section><section className="settings-section"><h2>工作区</h2><div className="settings-group form-settings"><div className="settings-row"><span>已添加项目</span><strong>{projectCount}</strong></div><div className="settings-row"><span>当前项目</span><strong>{activeProject?.name || "无"}</strong></div></div></section><section className="settings-section"><h2>对话</h2><div className="settings-group form-settings"><div className="settings-row conversation-sticky-setting"><span>上一轮问题 Sticky<small>滚动时在顶部显示上一条已完成的问题，点击可返回原位置</small></span><button type="button" role="switch" aria-label="对话 Sticky" aria-checked={draft.conversationSticky} className={`settings-switch ${draft.conversationSticky ? "is-on" : ""}`} onClick={() => update({ conversationSticky: !draft.conversationSticky })}><span /></button></div><div className="settings-row settings-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void execute(() => saveDraft("对话 Sticky 设置已保存"))}>保存对话设置</button></div></div></section></>}
      {section === "agents" && <section className="settings-section"><h2>底座 Agent</h2><div className="agent-settings-list">{agents.map((agent) => <article className="agent-settings-card" key={agent.id}><span className="agent-settings-icon"><Robot size={20} /></span><span className="agent-settings-copy"><strong>{agent.name}</strong><small>{agent.version || "运行时"} · {agent.installed ? "已下载" : "首次使用时下载"}</small><em>{agent.id === "claude-code" ? (agent.auth?.connected ? `已登录 · ${agent.auth.authMethod || "Claude"}` : "需要登录 Claude") : agent.id === "codex" ? (auth.connected ? "GPT OAuth 已连接" : "需要登录 Codex") : providerStore.profiles.some((profile) => profile.compatibleAgents.includes("pi")) ? "Provider 已配置" : "需要 Pi Provider"}</em></span><span className={`agent-settings-status ${agent.installed && agent.integrated ? "is-ready" : ""}`}>{agent.installed ? "已下载" : "未下载"}</span><div className="agent-settings-modes">{agent.modes?.map((item) => <span key={item.id}>{item.label}</span>)}</div><small className="agent-settings-models">{agent.id === "codex" && modelsLoading ? "正在加载模型…" : agent.id === "codex" && modelsError ? "模型加载失败" : `${agent.id === "codex" ? models.length : modelsByAgent[agent.id]?.length || 0} 个可用模型`}</small></article>)}</div></section>}
      {section === "providers" && <section className="settings-section provider-settings-section"><h2>Provider 配置</h2><p className="settings-help">配置 Pi 可使用的模型服务，API key 只保存在系统安全存储中。</p><ProviderProfiles store={providerStore} onSave={props.onProviderSave} onRemove={props.onProviderRemove} onSetActive={props.onProviderSetActive} onTest={props.onProviderTest} onNotify={onNotify} /></section>}
      {section === "appearance" && <section className="settings-section"><h2>外观</h2><div className="settings-group form-settings"><div className="settings-row"><span>主题</span><strong>浅色</strong></div><label className="settings-row"><span>UI 字号</span><span className="font-size-control"><input type="number" min="12" max="16" value={draft.uiFontSize} onChange={(event) => { const uiFontSize = Number(event.target.value); update({ uiFontSize }); document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`); }} /><em>px</em></span></label><div className="settings-row settings-actions"><button type="button" className="primary-button" onClick={() => void execute(() => saveDraft("外观设置已保存"))}>保存外观</button></div></div></section>}
      {section === "permissions" && <section className="settings-section"><h2>默认权限</h2><p className="settings-help">Codex 支持三种沙盒模式。Pi RPC 不提供逐次审批，因此“帮我批准”在 Pi 中会安全降级为只读模式；经确认开启的完整访问也会应用到 Pi。{permissionChangesLocked ? " 当前任务运行中，停止后才能修改权限。" : ""}</p><div className="settings-group form-settings"><div className="settings-row"><span>Codex / Pi</span><div className="reasoning-control" role="group" aria-label="Codex 和 Pi 默认权限">{Object.entries(sandboxLabels).map(([value, label]) => <button type="button" key={value} disabled={permissionChangesLocked} aria-pressed={draft.sandboxMode === value} className={draft.sandboxMode === value ? "is-selected" : ""} onClick={() => update({ sandboxMode: value as SandboxMode })}>{label}</button>)}</div></div><div className="settings-row settings-actions"><button type="button" className="primary-button" disabled={busy || permissionChangesLocked} onClick={savePermissions}>保存权限</button></div></div></section>}
      {section === "models" && <><section className="settings-section"><h2>GPT OAuth</h2><div className="settings-group oauth-group"><div className="settings-row provider-row"><div className="provider-mark"><OpenAiLogo size={27} /></div><strong>Codex CLI</strong><span className={auth.connected ? "connected-badge" : "disconnected-badge"}>{auth.connected ? "已连接" : "未登录"}</span><span className="provider-email">{auth.account?.email || auth.message || "未检测到登录"}</span><button type="button" className="secondary-button" onClick={() => void execute(async () => { await onLogin(); return "设备登录已启动"; })}>{auth.connected ? "重新登录" : "登录"}</button></div>{auth.connected && <button type="button" className="danger-link disconnect-link" onClick={() => { if (window.confirm("确认退出本机 Codex 登录？")) void execute(onLogout); }}>断开连接</button>}</div></section><section className="settings-section"><h2>连接方式</h2><div className="settings-group"><div className="settings-row provider-choice" role="group" aria-label="连接方式"><button type="button" aria-pressed={draft.provider === "codex"} className={draft.provider === "codex" ? "is-selected" : ""} onClick={() => update({ provider: "codex" })}>GPT OAuth</button><button type="button" aria-pressed={draft.provider === "custom"} className={draft.provider === "custom" ? "is-selected" : ""} onClick={() => update({ provider: "custom" })}>自定义服务</button></div></div></section>{draft.provider === "custom" && <section className="settings-section"><h2>自定义服务</h2><div className="settings-group form-settings"><label className="settings-row"><span>服务名称</span><input value={draft.serviceName} onChange={(event) => update({ serviceName: event.target.value })} /></label><label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label><label className="settings-row"><span>API key</span><span className="secret-input"><input type="password" value={apiKey} placeholder={draft.hasApiKey ? "已安全保存" : "输入 API key"} onChange={(event) => setApiKey(event.target.value)} /><Eye size={18} /></span></label><div className="settings-row settings-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void execute(async () => (await onTest({ ...draft, apiKey })).message)}>测试连接</button><button type="button" className="primary-button" disabled={busy} onClick={() => void execute(async () => { await onSave({ ...draft, apiKey }); setApiKey(""); return "已保存"; })}>保存服务</button></div></div></section>}<section className="settings-section"><h2>默认模型</h2><div className="settings-group form-settings"><label className="settings-row"><span>模型</span>{draft.provider === "codex" ? <select disabled={modelsLoading || !models.length} value={model?.model || ""} onChange={(event) => { const next = models.find((item) => item.model === event.target.value); if (next) update({ model: next.model, reasoning: next.supportedReasoningEfforts.some((item) => item.reasoningEffort === draft.reasoning) ? draft.reasoning : next.defaultReasoningEffort }); }}>{!models.length && <option value="">{modelsLoading ? "正在加载模型…" : modelsError ? userFacingError(modelsError) : "暂无可用模型"}</option>}{models.map((item) => <option key={item.id} value={item.model}>{item.displayName}{item.isDefault ? "（默认）" : ""}</option>)}</select> : <input value={draft.model} onChange={(event) => update({ model: event.target.value })} />}<button type="button" className="secondary-button" disabled={modelsLoading} onClick={() => update({ model: "", reasoning: models.find((item) => item.isDefault)?.defaultReasoningEffort || "medium" })}><ArrowsClockwise size={16} />使用默认</button></label><div className="settings-row"><span>思考程度</span><div className="reasoning-control" role="group" aria-label="思考程度">{efforts.map((value) => <button type="button" key={value} aria-pressed={draft.reasoning === value} className={draft.reasoning === value ? "is-selected" : ""} onClick={() => update({ reasoning: value })}>{reasoningLabels[value]}</button>)}</div></div><div className="settings-row settings-actions"><button type="button" className="primary-button" disabled={busy || modelsLoading || (draft.provider === "codex" && !models.length)} onClick={() => void execute(() => saveDraft("默认模型设置已保存"))}>保存默认设置</button></div></div></section></>}
      {section === "shortcuts" && <section className="settings-section"><h2>键盘快捷键</h2><div className="settings-group shortcut-list">{[["打开设置", "⌘,"], ["新建独立会话", "⌘N"], ["打开终端", "⌃`"], ["审查变更", "⌃⇧G"]].map(([label, key]) => <div className="settings-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div></section>}
      {section === "git" && <section className="settings-section"><h2>当前仓库</h2><div className="settings-group form-settings"><div className="settings-row"><span>项目</span><strong>{activeProject?.name || "未选择项目"}</strong></div><div className="settings-row"><span>路径</span><strong>{activeProject?.path || "—"}</strong></div><div className="settings-row"><span>分支</span><strong>{gitState.branch}</strong></div><div className="settings-row"><span>变更文件</span><strong>{gitState.files.length}</strong></div></div></section>}
      {section === "environment" && <section className="settings-section"><h2>运行环境</h2><div className="settings-group form-settings">{[["Rux", systemInfo.appVersion], ["Codex", systemInfo.codexVersion], ["Electron", systemInfo.electronVersion], ["Chromium", systemInfo.chromeVersion], ["平台", `${systemInfo.platform || "—"} ${systemInfo.arch || ""}`]].map(([label, value]) => <div className="settings-row" key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}</div></section>}
      {status && <p role="status" aria-live="polite" className={`settings-status ${statusError ? "error-text" : busy ? "" : "connected"}`}>{status}</p>}
    </main>
    {fullAccessConfirmOpen && <FullAccessModal onCancel={() => setFullAccessConfirmOpen(false)} onConfirm={confirmFullAccess} onLearnMore={() => onNotify("完整访问会跳过 Rux 的逐次批准，但仍受操作系统账户和隐私权限限制")} />}
  </div>;
}
