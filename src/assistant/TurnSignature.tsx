import { Button, IconButton } from "../ui";
import { useEffect, useRef, useState } from "react";
import { X } from "../ui/icons";
import FloatingPopover from "../components/FloatingPopover";
import { reasoningLabels } from "../composer/ComposerControls";
import type { TurnInfo } from "../shared/turn-info";

const agentNames: Record<string, string> = { codex: "Codex", "claude-code": "Claude Code", pi: "Pi", api: "自定义 API" };
const numbers = new Intl.NumberFormat("en-US");

export function turnModelName(info?: TurnInfo): string {
  const model = info?.modelLabel || info?.model;
  if (!model || model === "default") return "模型未记录";
  return model.replace(/^[^/]+\//, "").replace(/^gpt-/i, "GPT-").replace(/^(GPT-[\d.]+)-/i, "$1 ").replace(/\b(astra|sol|terra|luna)\b/gi, (part) => part[0].toUpperCase() + part.slice(1));
}

export function turnDuration(milliseconds?: number): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return "耗时未记录";
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, "")} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
}

export default function TurnSignature({ info, agentId, running, createdAt }: { info?: TurnInfo; agentId?: string; running: boolean; createdAt?: Date }) {
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const usageTrigger = useRef<HTMLButtonElement>(null);
  const usagePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const agent = info?.agentId || agentId;
  const start = info?.startedAt ?? createdAt?.getTime();
  const elapsed = running && start !== undefined ? Math.max(0, now - start) : info?.elapsedMs ?? (info?.completedAt !== undefined && start !== undefined ? Math.max(0, info.completedAt - start) : undefined);
  const effort = info?.reasoning ? `${reasoningLabels[info.reasoning] || info.reasoning}思考` : "思考未记录";
  const count = info?.usage?.totalTokens;
  const usageLabel = count === undefined ? running ? "Token 统计中" : "Token 未记录" : `${numbers.format(count)} tokens`;
  const fields = [
    ["inputTokens", "输入"], ["cachedInputTokens", "其中缓存读取"], ["cacheWriteInputTokens", "其中缓存写入"],
    ["outputTokens", "输出"], ["reasoningOutputTokens", "其中思考"],
  ] as const;
  return <div className="turn-signature" aria-label="本轮运行信息">
    <span>{agent ? agentNames[agent] || agent : "Agent 未记录"}</span>
    <span className="turn-model" title={info?.model || "历史记录未提供模型"}>{turnModelName(info)}</span>
    <span title={info?.mode ? `Agent 模式：${info.mode}` : undefined}>{info?.mode === "plan" ? `计划 / ${effort}` : effort}</span>
    <span>{count === undefined ? usageLabel : <Button variant="plain" ref={usageTrigger} type="button" className="turn-usage-trigger" aria-label={`本轮 Token 明细：${numbers.format(count)}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>{usageLabel}</Button>}</span>
    <span>{running ? `已用 ${turnDuration(elapsed)}` : turnDuration(elapsed)}</span>
    {open && <FloatingPopover anchorRef={usageTrigger} scope="turn-usage" onDismiss={() => setOpen(false)}><div ref={usagePanel} className="turn-usage-panel" role="dialog" aria-label="本轮 Token 明细">
      <header><strong>本轮 Token 明细</strong><IconButton data-autofocus label="关闭用量明细" icon="close" tooltip={false} onClick={() => setOpen(false)} /></header>
      <dl>{fields.map(([key, label]) => info?.usage?.[key] === undefined ? null : <div key={key} className={label.startsWith("其中") ? "is-subset" : ""}><dt>{label}</dt><dd>{numbers.format(info.usage[key]!)}</dd></div>)}<div className="turn-usage-total"><dt>合计</dt><dd>{numbers.format(count || 0)}</dd></div></dl>
      <p>按 Agent 返回的本轮用量记录。缓存与思考是输入、输出的子集，不重复相加。</p>
    </div></FloatingPopover>}
  </div>;
}
