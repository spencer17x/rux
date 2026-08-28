import { Check, CircleNotch, HandPalm, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import type { AuthState } from "../renderer/types";
import { userFacingError } from "../renderer/errors";

export type Reasoning = "none" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ComposerSettings = { provider: "codex" | "custom"; serviceName: string; model: string; reasoning: Reasoning; sandboxMode: SandboxMode };
export type ModelInfo = { id: string; model: string; displayName: string; description?: string; isDefault?: boolean; defaultReasoningEffort: Reasoning; supportedReasoningEfforts: Array<{ reasoningEffort: Reasoning; description?: string }> };

export const reasoningLabels: Record<string, string> = { none: "无", off: "关闭", minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大", ultra: "Ultra" };
const permissionOptions = [
  { value: "read-only" as const, shortLabel: "请求批准", title: "请求批准", description: "编辑外部文件和使用互联网时始终询问", Icon: HandPalm },
  { value: "workspace-write" as const, shortLabel: "帮我批准", title: "帮我批准", description: "仅对检测到的风险操作请求批准", Icon: ShieldCheck },
  { value: "danger-full-access" as const, shortLabel: "完全访问", title: "完全访问权限", description: "可不受限制地访问互联网和你电脑上的任何文件", Icon: WarningCircle },
];
export const sandboxLabels = Object.fromEntries(permissionOptions.map((option) => [option.value, option.shortLabel])) as Record<SandboxMode, string>;

export function selectedModel(settings: Pick<ComposerSettings, "model">, models: ModelInfo[]): ModelInfo | undefined {
  return models.find((model) => model.model === settings.model) || models.find((model) => model.isDefault) || models[0];
}

export function modelDisplayName(settings: Pick<ComposerSettings, "model">, models: ModelInfo[]): string {
  return selectedModel(settings, models)?.displayName || settings.model || "默认模型";
}

export function ModelPopover({ mode, settings, auth, models, loading, error, onSelectModel, onSelectReasoning, connectionLabel }: { mode: "models" | "reasoning"; settings: ComposerSettings; auth: AuthState; models: ModelInfo[]; loading: boolean; error: string; onSelectModel: (model: ModelInfo) => void; onSelectReasoning: (reasoning: Reasoning) => void; connectionLabel?: string }) {
  const current = selectedModel(settings, models);
  const efforts = current?.supportedReasoningEfforts || Object.keys(reasoningLabels).map((reasoningEffort) => ({ reasoningEffort: reasoningEffort as Reasoning, description: "" }));
  return <div className={`model-popover ${mode === "models" ? "model-picker-popover" : "reasoning-picker-popover"}`} role="dialog" aria-label={mode === "models" ? "选择模型" : "选择思考程度"}>
    <div className="popover-heading"><strong>{mode === "models" ? "选择模型" : "思考程度"}</strong><span className={auth.connected ? "status-dot" : "status-dot offline"} /></div>
    {loading && <div className="picker-state" role="status"><CircleNotch size={16} className="spin" />正在读取 Agent 模型…</div>}{error && <div className="picker-state error-text" role="alert">{userFacingError(error)}</div>}
    {!loading && mode === "models" && models.map((model) => <button type="button" aria-pressed={current?.model === model.model} className={`picker-option ${current?.model === model.model ? "is-selected" : ""}`} key={model.id} onClick={() => onSelectModel(model)}><span><strong>{model.displayName}</strong><small>{model.description}</small></span>{model.isDefault && <em>默认</em>}{current?.model === model.model && <Check size={17} weight="bold" />}</button>)}
    {!loading && mode === "reasoning" && efforts.map((effort) => <button type="button" aria-pressed={settings.reasoning === effort.reasoningEffort} className={`picker-option ${settings.reasoning === effort.reasoningEffort ? "is-selected" : ""}`} key={effort.reasoningEffort} onClick={() => onSelectReasoning(effort.reasoningEffort)}><span><strong>{reasoningLabels[effort.reasoningEffort] || effort.reasoningEffort}</strong><small>{effort.description}</small></span>{settings.reasoning === effort.reasoningEffort && <Check size={17} weight="bold" />}</button>)}
    <div className="popover-footer">{connectionLabel || (settings.provider === "codex" ? `${modelDisplayName(settings, models)} · GPT OAuth` : settings.serviceName)}</div>
  </div>;
}

export function PermissionPopover({ selectedValue, onSelect, onLearnMore }: { selectedValue: SandboxMode; onSelect: (value: SandboxMode) => void; onLearnMore: () => void }) {
  return <span className="scope-popover permission-popover" role="dialog" aria-label="操作批准方式"><span className="permission-popover-heading"><strong>应如何批准 Rux 操作？</strong><button type="button" onClick={onLearnMore}>了解更多</button></span>{permissionOptions.map(({ value, title, description, Icon }) => <button type="button" key={value} aria-pressed={selectedValue === value} className={`permission-option ${selectedValue === value ? "is-selected" : ""}`} onClick={() => onSelect(value)}><Icon size={20} /><span><strong>{title}</strong><small>{description}</small></span>{selectedValue === value && <Check size={18} weight="bold" />}</button>)}</span>;
}
