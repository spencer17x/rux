import { AppIcon, Button, SteppedSlider, Switch, Modal, ChoiceList, ChoiceItem } from "../ui";
import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, CaretLeft, CaretRight, Lightning, Check, CircleNotch, FolderOpen, Globe, TerminalWindow, WarningCircle } from "../ui/icons";
import { navigateMenu } from "../components/menuKeyboard";
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

type SelectionResult = void | boolean | Promise<void | boolean>;
type ModelPopoverProps = {
  settings: ComposerSettings; auth: AuthState; models: ModelInfo[]; loading: boolean; error: string; serviceTier: string | null;
  onSelectModel: (model: ModelInfo) => SelectionResult;
  onSelectReasoning: (reasoning: Reasoning) => SelectionResult;
  onSelectServiceTier: (serviceTier: string | null) => SelectionResult;
  onReset?: () => SelectionResult;
  onClose?: () => void;
};

export function ModelPopover({ settings, models, loading, error, serviceTier, onSelectModel, onSelectReasoning, onSelectServiceTier, onReset, onClose }: ModelPopoverProps) {
  const [view, setView] = useState<"power" | "models" | "speed">("power");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pending = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const current = selectedModel(settings, models);
  const efforts = current?.supportedReasoningEfforts || [];
  const tiers = current?.serviceTiers || [];
  const selectedIndex = Math.max(0, efforts.findIndex((effort) => effort.reasoningEffort === settings.reasoning));
  const [previewIndex, setPreviewIndex] = useState(selectedIndex);
  const previewRef = useRef(selectedIndex);
  const dragging = useRef(false);
  const ticksId = useId();
  const hintId = useId();
  const speedId = useId();
  const selectedTier = tiers.find((tier) => tier.id === serviceTier);
  const previewEffort = efforts[previewIndex]?.reasoningEffort || settings.reasoning;
  const effortLabel = reasoningLabels[previewEffort] || previewEffort;
  const speedLabel = selectedTier?.id === "priority" ? "快速" : selectedTier?.name || "标准";
  useEffect(() => {
    if (dragging.current) return;
    previewRef.current = selectedIndex;
    setPreviewIndex(selectedIndex);
  }, [current?.model, selectedIndex]);
  const apply = async (action: () => SelectionResult, returnToPower = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setSaveError("");
    try {
      const result = await action();
      if (result === false) { previewRef.current = selectedIndex; setPreviewIndex(selectedIndex); return; }
      if (returnToPower) {
        setView("power");
        requestAnimationFrame(() => (rangeRef.current || modelButtonRef.current)?.focus({ preventScroll: true }));
      }
    } catch (error) {
      setSaveError(userFacingError(error)); previewRef.current = selectedIndex; setPreviewIndex(selectedIndex);
    } finally { pending.current = false; setBusy(false); }
  };
  const commitEffort = () => {
    dragging.current = false;
    const effort = efforts[previewRef.current]?.reasoningEffort;
    if (effort && effort !== settings.reasoning) void apply(() => onSelectReasoning(effort));
  };
  const changeView = (next: "models" | "speed") => {
    setView(next);
    requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>("[role='menuitemradio'][aria-checked='true'], [role='menuitemradio']")?.focus({ preventScroll: true }));
  };
  const returnToPower = () => { setView("power"); requestAnimationFrame(() => modelButtonRef.current?.focus({ preventScroll: true })); };
  const toggleSpeed = () => {
    if (tiers.length === 1) void apply(() => onSelectServiceTier(serviceTier ? null : tiers[0].id));
    else changeView("speed");
  };

  return <div ref={popoverRef} className="model-popover model-picker" role="dialog" aria-label="切换模型、推理强度和速度" aria-busy={busy} onKeyDown={(event) => {
    if (event.key === "ArrowLeft" && view !== "power") { event.preventDefault(); event.stopPropagation(); returnToPower(); return; }
    navigateMenu(event);
  }}>
    {view === "power" ? <>
      <div className="model-picker-header">
        <Button variant="plain" ref={modelButtonRef} type="button" className="model-picker-model" aria-label="选择模型" aria-haspopup="menu" disabled={busy || loading || !models.length} onClick={() => changeView("models")} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); changeView("models"); } }}><AppIcon name="cpu" size="md" /><strong title={modelDisplayName(settings, models)}>{modelDisplayName(settings, models)}</strong><span className="model-picker-change">切换<CaretRight size="sm" /></span></Button>
      </div>
      {loading ? <div className="picker-state" role="status"><CircleNotch size="sm" className="spin" />正在读取 Agent 模型…</div> : error ? <div className="picker-state error-text" role="alert">{userFacingError(error)}</div> : !current ? <div className="picker-state" role="status">暂无可用模型，请在设置中检查账户与连接。</div> : efforts.length > 1 ? <div className="model-picker-power">
        <div className="model-picker-power-heading"><label htmlFor={ticksId}>思考强度</label><span>{effortLabel}</span></div>
        <SteppedSlider ref={rangeRef} data-autofocus id={ticksId} labels={efforts.map((effort) => reasoningLabels[effort.reasoningEffort] || effort.reasoningEffort)} value={Math.min(previewIndex, efforts.length - 1)} disabled={busy} aria-label="推理强度" aria-valuetext={effortLabel} aria-describedby={hintId} onPointerDown={() => { dragging.current = true; }} onChange={(event) => { const index = Number(event.currentTarget.value); previewRef.current = index; setPreviewIndex(index); }} onPointerUp={commitEffort} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commitEffort(); onClose?.(); } }} onPointerCancel={() => { dragging.current = false; previewRef.current = selectedIndex; setPreviewIndex(selectedIndex); }} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commitEffort(); }} onBlur={() => { if (!dragging.current) commitEffort(); }} />
        <span id={hintId} className="sr-only">使用左右方向键调整当前模型的推理强度；拖动时预览，松开后保存。</span>
      </div> : <p className="model-picker-no-efforts">该模型没有可调的推理强度</p>}
      {!loading && !error && current && previewEffort === "ultra" && <p className="model-picker-usage">更快消耗使用额度</p>}
      {(tiers.length > 0 || onReset) && <div className="model-picker-footer">
        {tiers.length === 1 ? <div className="model-picker-speed"><label htmlFor={speedId}><Lightning size="md" />{tiers[0].id === "priority" ? "快速模式" : tiers[0].name}</label><Switch id={speedId} checked={Boolean(selectedTier)} disabled={busy || loading || Boolean(error)} title={tiers[0].description} onCheckedChange={(checked) => void apply(() => onSelectServiceTier(checked ? tiers[0].id : null))} /></div> : tiers.length > 1 ? <Button variant="plain" type="button" className="model-picker-speed-choice" aria-label="选择速度" disabled={busy || loading || Boolean(error)} onClick={toggleSpeed}><Lightning size="md" />{speedLabel}<CaretRight size="xs" /></Button> : null}
        {busy && <CircleNotch size="xs" className="spin model-picker-saving" aria-label="正在保存" />}
        {onReset && <Button variant="plain" type="button" className="model-picker-reset" aria-label="恢复默认模型设置" disabled={busy || loading || !models.length} onClick={() => void apply(onReset)}>恢复默认</Button>}
      </div>}
    </> : <>
      <div className="model-picker-list-heading"><Button variant="plain" type="button" aria-label="返回推理强度" onClick={returnToPower}><CaretLeft size="sm" /></Button><strong>{view === "models" ? "选择模型" : "速度"}</strong></div>
      <ChoiceList className="model-picker-list" aria-label={view === "models" ? "模型" : "速度"}>
        {view === "models" ? models.map((model) => <ChoiceItem checked={current?.model === model.model} className="model-picker-option" key={model.id} disabled={busy} onClick={() => void apply(() => onSelectModel(model), true)}><span>{model.displayName}{model.isDefault && <small>推荐</small>}</span>{current?.model === model.model && <Check size="sm" />}</ChoiceItem>) : [{ id: "", name: "标准", description: "默认速度" }, ...tiers].map((tier) => <ChoiceItem checked={(serviceTier || "") === tier.id} className="model-picker-option" key={tier.id} disabled={busy} onClick={() => void apply(() => onSelectServiceTier(tier.id || null), true)}><span>{tier.id === "priority" ? "快速" : tier.name}<small>{tier.description}</small></span>{(serviceTier || "") === tier.id && <Check size="sm" />}</ChoiceItem>)}
      </ChoiceList>
    </>}
    {saveError && <p className="picker-state error-text" role="alert">{saveError}</p>}
  </div>;
}

export function PermissionPopover({ selectedValue, onSelect, onLearnMore, agentId = "codex" }: { selectedValue: SandboxMode; onSelect: (value: SandboxMode) => void; onLearnMore: () => void; agentId?: "codex" | "pi" }) {
  const options = agentId === "pi" ? permissionOptions.map((option) => option.value === "read-only"
    ? { ...option, title: "只读模式", description: "仅保留文件读取和搜索工具，不提供命令或写入工具" }
    : option.value === "workspace-write"
      ? { ...option, description: "Pi RPC 暂不支持逐次审批，请使用只读或完整访问" }
      : option) : permissionOptions;
  return <span className="scope-popover permission-popover" onKeyDown={navigateMenu} role="dialog" aria-label="操作批准方式"><span className="permission-popover-heading"><strong>应如何批准 Rux 操作？</strong><Button variant="plain" type="button" onClick={onLearnMore}>了解更多</Button></span>{options.map(({ value, title, description }) => {
    const disabled = agentId === "pi" && value === "workspace-write";
    return <Button variant="plain" type="button" data-menu-item key={value} disabled={disabled} aria-disabled={disabled} aria-pressed={selectedValue === value} className={`permission-option ${value === "danger-full-access" ? "is-danger" : ""} ${selectedValue === value ? "is-selected" : ""}`} onClick={() => onSelect(value)}><PermissionModeIcon mode={value as PermissionMode} size="md" /><span><strong>{title}</strong><small>{description}</small></span>{selectedValue === value && <Check size="md" variant="strong" />}</Button>;
  })}</span>;
}

export function FullAccessModal({ onCancel, onConfirm, onLearnMore }: { onCancel: () => void; onConfirm: () => Promise<void>; onLearnMore: () => void }) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirm = async () => { if (busy) return; setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return <Modal alert label="要开启完整访问权限吗？" onClose={onCancel} busy={busy} initialFocusRef={cancelRef} className="full-access-modal">
    <div className="full-access-title"><WarningCircle size="lg" /><h2 id="full-access-title">要开启完整访问权限吗？</h2></div>
    <p className="full-access-intro">Rux 将跳过逐次操作批准，并可在当前系统账户及操作系统已授予 Rux 的权限范围内运行命令、使用互联网，以及创建和编辑文件。这包括但不限于：</p>
    <div className="full-access-capabilities"><div><FolderOpen size="lg" variant="solid" /><span><strong>文件和文件夹</strong><small>读取、创建、修改、上传或删除操作系统允许访问位置的文件</small></span></div><div><TerminalWindow size="lg" variant="solid" /><span><strong>终端命令</strong><small>运行命令、安装软件和更改当前账户可修改的系统设置</small></span></div><div><Globe size="lg" variant="solid" /><span><strong>互联网和已连接的应用</strong><small>访问网站、发送数据并使用已启用的插件或连接</small></span></div></div>
    <p className="full-access-risk">这会带来敏感数据丢失或泄露、提示注入等风险。你可以随时将其关闭。<Button variant="plain" type="button" onClick={onLearnMore}>了解更多</Button></p>
    <div className="modal-footer full-access-actions"><Button variant="secondary" ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</Button><Button variant="plain" type="button" className="full-access-confirm" disabled={busy} onClick={() => void confirm()}><WarningCircle size="sm" />{busy ? "正在启用…" : "确认"}</Button></div>
  </Modal>;
}
