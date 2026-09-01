import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight, CaretUp, Check, CircleNotch, FolderOpen, Globe, TerminalWindow, WarningCircle } from "@phosphor-icons/react";
import type { AuthState } from "../renderer/types";
import { userFacingError } from "../renderer/errors";
import PermissionModeIcon, { type PermissionMode } from "../components/PermissionModeIcon";

export type Reasoning = "none" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ComposerSettings = { provider: "codex" | "custom"; serviceName: string; model: string; reasoning: Reasoning; sandboxMode: SandboxMode };
export type ModelInfo = { id: string; model: string; displayName: string; description?: string; isDefault?: boolean; defaultReasoningEffort: Reasoning; supportedReasoningEfforts: Array<{ reasoningEffort: Reasoning; description?: string }>; serviceTiers?: Array<{ id: string; name: string; description: string }>; defaultServiceTier?: string | null };

export const reasoningLabels: Record<string, string> = { none: "无", off: "关闭", minimal: "最小", low: "轻度", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "Ultra" };
const permissionOptions = [
  { value: "read-only" as const, shortLabel: "请求批准", title: "请求批准", description: "编辑外部文件和使用互联网时始终询问" },
  { value: "workspace-write" as const, shortLabel: "帮我批准", title: "帮我批准", description: "仅对检测到的风险操作请求批准" },
  { value: "danger-full-access" as const, shortLabel: "完全访问", title: "完全访问权限", description: "可不受限制地访问互联网和你电脑上的任何文件" },
];
export const sandboxLabels = Object.fromEntries(permissionOptions.map((option) => [option.value, option.shortLabel])) as Record<SandboxMode, string>;

export function selectedModel(settings: Pick<ComposerSettings, "model">, models: ModelInfo[]): ModelInfo | undefined {
  return models.find((model) => model.model === settings.model) || models.find((model) => model.isDefault) || models[0];
}

export function modelDisplayName(settings: Pick<ComposerSettings, "model">, models: ModelInfo[]): string {
  return selectedModel(settings, models)?.displayName || settings.model || "默认模型";
}

export function compactModelName(value: string): string {
  return value.replace(/^GPT[- ]?/i, "").replace(/^([\d.]+)-([A-Za-z])/, "$1 $2");
}

type RunSettingsSection = "models" | "reasoning" | "speed";

export function ModelPopover({ settings, models, loading, error, serviceTier, onSelectModel, onSelectReasoning, onSelectServiceTier }: { settings: ComposerSettings; auth: AuthState; models: ModelInfo[]; loading: boolean; error: string; serviceTier: string | null; onSelectModel: (model: ModelInfo) => void; onSelectReasoning: (reasoning: Reasoning) => void; onSelectServiceTier: (serviceTier: string | null) => void }) {
  const [section, setSection] = useState<RunSettingsSection | null>(null);
  const [advanced, setAdvanced] = useState(true);
  const current = selectedModel(settings, models);
  const efforts = current?.supportedReasoningEfforts || Object.keys(reasoningLabels).map((reasoningEffort) => ({ reasoningEffort: reasoningEffort as Reasoning, description: "" }));
  const tiers = current?.serviceTiers || [];
  const selectedTier = tiers.find((tier) => tier.id === serviceTier);
  const speedLabel = selectedTier?.id === "priority" ? "快速" : selectedTier?.name || "标准";
  const sectionLabel = section === "models" ? "模型" : section === "reasoning" ? "推理强度" : section === "speed" ? "速度" : "";
  const activateSection = (next: RunSettingsSection) => setSection(next);
  return <div className="model-popover run-settings-popover" role="dialog" aria-label="切换模型、推理强度和速度" onMouseLeave={() => setSection(null)}>
    <div className="run-settings-main" role="menu" aria-label="运行设置">
      {advanced && <>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={section === "models"} className={section === "models" ? "is-selected" : ""} onMouseEnter={() => setSection("models")} onFocus={() => setSection("models")} onClick={() => activateSection("models")}><strong>模型</strong><span>{compactModelName(modelDisplayName(settings, models))}</span><CaretRight size={17} /></button>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={section === "reasoning"} className={section === "reasoning" ? "is-selected" : ""} onMouseEnter={() => setSection("reasoning")} onFocus={() => setSection("reasoning")} onClick={() => activateSection("reasoning")}><strong>推理强度</strong><span>{reasoningLabels[settings.reasoning] || settings.reasoning}</span><CaretRight size={17} /></button>
        {tiers.length > 0 && <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={section === "speed"} className={section === "speed" ? "is-selected" : ""} onMouseEnter={() => setSection("speed")} onFocus={() => setSection("speed")} onClick={() => activateSection("speed")}><strong>速度</strong><span>{speedLabel}</span><CaretRight size={17} /></button>}
      </>}
      <button type="button" role="menuitem" className="run-settings-advanced" aria-expanded={advanced} onClick={() => { setAdvanced((value) => !value); setSection(null); }}><strong>高级</strong>{advanced ? <CaretUp size={15} /> : <CaretDown size={15} />}</button>
    </div>
    {advanced && section && <div className={`run-settings-submenu is-${section}`} role="menu" aria-label={sectionLabel}>
      {section !== "models" && <div className="run-settings-heading">{sectionLabel}</div>}
      {section === "models" && loading && <div className="picker-state" role="status"><CircleNotch size={16} className="spin" />正在读取 Agent 模型…</div>}
      {section === "models" && error && <div className="picker-state error-text" role="alert">{userFacingError(error)}</div>}
      {section === "models" && !loading && models.map((model) => <button type="button" role="menuitemradio" aria-checked={current?.model === model.model} className="run-settings-option" key={model.id} onClick={() => onSelectModel(model)}><span><strong>{compactModelName(model.displayName)}</strong></span>{current?.model === model.model && <Check size={17} />}</button>)}
      {section === "reasoning" && efforts.map((effort) => <button type="button" role="menuitemradio" aria-checked={settings.reasoning === effort.reasoningEffort} className="run-settings-option" key={effort.reasoningEffort} onClick={() => onSelectReasoning(effort.reasoningEffort)}><span><strong>{reasoningLabels[effort.reasoningEffort] || effort.reasoningEffort}</strong>{effort.reasoningEffort === "ultra" && <small>更快消耗使用额度</small>}</span>{settings.reasoning === effort.reasoningEffort && <Check size={17} />}</button>)}
      {section === "speed" && <button type="button" role="menuitemradio" aria-checked={!serviceTier} className="run-settings-option" onClick={() => onSelectServiceTier(null)}><span><strong>标准</strong><small>默认速度</small></span>{!serviceTier && <Check size={17} />}</button>}
      {section === "speed" && tiers.map((tier) => <button type="button" role="menuitemradio" aria-checked={serviceTier === tier.id} className="run-settings-option" key={tier.id} onClick={() => onSelectServiceTier(tier.id)}><span><strong>{tier.id === "priority" ? "快速" : tier.name}</strong><small>{tier.id === "priority" ? "1.5 倍速度，用量更多" : tier.description}</small></span>{serviceTier === tier.id && <Check size={17} />}</button>)}
    </div>}
  </div>;
}

export function PermissionPopover({ selectedValue, onSelect, onLearnMore, agentId = "codex" }: { selectedValue: SandboxMode; onSelect: (value: SandboxMode) => void; onLearnMore: () => void; agentId?: "codex" | "pi" }) {
  const options = agentId === "pi" ? permissionOptions.map((option) => option.value === "read-only"
    ? { ...option, title: "只读模式", description: "仅保留文件读取和搜索工具，不提供命令或写入工具" }
    : option.value === "workspace-write"
      ? { ...option, description: "Pi RPC 暂不支持逐次审批，请使用只读或完整访问" }
      : option) : permissionOptions;
  return <span className="scope-popover permission-popover" role="dialog" aria-label="操作批准方式"><span className="permission-popover-heading"><strong>应如何批准 Rux 操作？</strong><button type="button" onClick={onLearnMore}>了解更多</button></span>{options.map(({ value, title, description }) => {
    const disabled = agentId === "pi" && value === "workspace-write";
    return <button type="button" key={value} disabled={disabled} aria-disabled={disabled} aria-pressed={selectedValue === value} className={`permission-option ${value === "danger-full-access" ? "is-danger" : ""} ${selectedValue === value ? "is-selected" : ""}`} onClick={() => onSelect(value)}><PermissionModeIcon mode={value as PermissionMode} size={20} /><span><strong>{title}</strong><small>{description}</small></span>{selectedValue === value && <Check size={18} weight="bold" />}</button>;
  })}</span>;
}

export function FullAccessModal({ onCancel, onConfirm, onLearnMore }: { onCancel: () => void; onConfirm: () => Promise<void>; onLearnMore: () => void }) {
  const [busy, setBusy] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const backdrop = backdropRef.current;
    const siblings = backdrop?.parentElement ? [...backdrop.parentElement.children].filter((element) => element !== backdrop) as HTMLElement[] : [];
    for (const sibling of siblings) { sibling.inert = true; sibling.setAttribute("aria-hidden", "true"); }
    cancelRef.current?.focus();
    return () => { for (const sibling of siblings) { sibling.inert = false; sibling.removeAttribute("aria-hidden"); } requestAnimationFrame(() => previousFocus?.focus()); };
  }, []);
  const confirm = async () => { if (busy) return; setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return <div ref={backdropRef} className="modal-backdrop full-access-backdrop" role="presentation"><section ref={dialogRef} className="modal full-access-modal" role="alertdialog" aria-modal="true" aria-labelledby="full-access-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); return; } if (event.key !== "Tab") return; const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") || [])]; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}>
    <div className="full-access-title"><WarningCircle size={24} /><h2 id="full-access-title">要开启完整访问权限吗？</h2></div>
    <p className="full-access-intro">Rux 将跳过逐次操作批准，并可在当前系统账户及操作系统已授予 Rux 的权限范围内运行命令、使用互联网，以及创建和编辑文件。这包括但不限于：</p>
    <div className="full-access-capabilities"><div><FolderOpen size={25} weight="fill" /><span><strong>文件和文件夹</strong><small>读取、创建、修改、上传或删除操作系统允许访问位置的文件</small></span></div><div><TerminalWindow size={25} weight="fill" /><span><strong>终端命令</strong><small>运行命令、安装软件和更改当前账户可修改的系统设置</small></span></div><div><Globe size={26} weight="fill" /><span><strong>互联网和已连接的应用</strong><small>访问网站、发送数据并使用已启用的插件或连接</small></span></div></div>
    <p className="full-access-risk">这会带来敏感数据丢失或泄露、提示注入等风险。你可以随时将其关闭。<button type="button" onClick={onLearnMore}>了解更多</button></p>
    <div className="modal-footer full-access-actions"><button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="full-access-confirm" disabled={busy} onClick={() => void confirm()}><WarningCircle size={17} />{busy ? "正在启用…" : "确认"}</button></div>
  </section></div>;
}
