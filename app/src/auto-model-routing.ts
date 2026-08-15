import type {
  AutoModelPolicy,
  AutoModelStrategy,
  RunModelClassification,
  RunAdapter,
} from "./shared/protocol.ts";

export const autoRoutingReasonLabels = {
  "long-prompt": "请求包含较长的上下文",
  "multi-step": "请求包含多个步骤或交付物",
  "code-change": "请求涉及实现、修改或重构代码",
  "diagnosis": "请求涉及调试、故障定位或性能分析",
  "architecture": "请求涉及架构、迁移、安全或跨模块设计",
  "verification": "请求要求测试、构建或验收",
  "structured-input": "请求包含代码块、日志或结构化数据",
  "simple-intent": "请求是简短的解释、查询或轻量编辑",
  "strategy-threshold": "根据当前 Auto 策略阈值完成分类",
} as const;

export type AutoRoutingReasonCode = keyof typeof autoRoutingReasonLabels;

export interface AutoRoutingClassification {
  classification: RunModelClassification;
  score: number;
  threshold: number;
  reasonCodes: AutoRoutingReasonCode[];
  rationale: string;
}

const strategyThresholds: Record<AutoModelStrategy, number> = {
  conservative: 6,
  balanced: 4,
  quality: 2,
};

const countMatches = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0;

export function classifyAutoModelPrompt(prompt: string, strategy: AutoModelStrategy): AutoRoutingClassification {
  const value = prompt.trim();
  const lower = value.toLocaleLowerCase();
  const reasonCodes: AutoRoutingReasonCode[] = [];
  let score = 0;

  if (value.length >= 600) {
    score += value.length >= 1_500 ? 3 : 2;
    reasonCodes.push("long-prompt");
  }
  if (countMatches(value, /(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/gm) >= 3
    || /(?:首先|然后|最后|同时|以及|并且|step\s*\d|first.+then)/i.test(value)) {
    score += 2;
    reasonCodes.push("multi-step");
  }
  if (/(实现|开发|修改|修复|重构|编码|patch|implement|refactor|rewrite|edit\s+(?:the\s+)?(?:code|file))/i.test(lower)) {
    score += 2;
    reasonCodes.push("code-change");
  }
  if (/(调试|排查|根因|故障|性能|竞态|死锁|debug|diagnos|root cause|race condition|performance)/i.test(lower)) {
    score += 3;
    reasonCodes.push("diagnosis");
  }
  if (/(架构|迁移|安全|权限边界|协议|数据库|跨模块|architecture|migration|security|protocol|schema)/i.test(lower)) {
    score += 3;
    reasonCodes.push("architecture");
  }
  if (/(测试|验收|构建|发布|回归|test|verify|acceptance|build|release)/i.test(lower)) {
    score += 2;
    reasonCodes.push("verification");
  }
  if (/```|\{[\s\S]{80,}\}|(?:^|\n)(?:error|exception|traceback|diff --git)\b/im.test(value)) {
    score += 2;
    reasonCodes.push("structured-input");
  }
  if (value.length <= 180
    && /^(解释|说明|总结|翻译|润色|查找|列出|是什么|为什么|how|what|why|explain|summarize|translate|list)\b/i.test(value)) {
    score -= 2;
    reasonCodes.push("simple-intent");
  }

  const threshold = strategyThresholds[strategy];
  const classification: RunModelClassification = score >= threshold ? "complex" : "simple";
  const uniqueReasons = [...new Set<AutoRoutingReasonCode>([...reasonCodes, "strategy-threshold"])] as AutoRoutingReasonCode[];
  const rationale = `${uniqueReasons.map((code) => autoRoutingReasonLabels[code]).join("；")}。复杂度分数 ${score}，${strategy} 阈值 ${threshold}，判定为${classification === "complex" ? "复杂" : "简单"}任务。`;
  return { classification, score, threshold, reasonCodes: uniqueReasons, rationale };
}

export function selectAutoModel(policy: AutoModelPolicy, prompt: string): AutoRoutingClassification & { model: string } {
  const classification = classifyAutoModelPrompt(prompt, policy.strategy);
  return {
    ...classification,
    model: classification.classification === "complex" ? policy.complexModel.model : policy.simpleModel.model,
  };
}

export function isExplicitModelIncompatibility(error: string): boolean {
  return /(model[_ -]not[_ -]found|unsupported[_ -]model|invalid[_ -]model|unknown model|model[^\n]{0,100}(does not exist|not found|not supported|unsupported|incompatible))/i.test(error);
}

export function engineSupportsPerRunModelSelection(adapter: RunAdapter): boolean {
  return adapter === "codex" || adapter === "claude-code";
}

export function assertNativeSessionModelCompatibility(adapter: RunAdapter, previousModel: string | undefined, selectedModel: string, declaredPerRunSelection = false): void {
  if (!previousModel || previousModel === selectedModel || engineSupportsPerRunModelSelection(adapter) || declaredPerRunSelection) return;
  throw new Error(`当前 ${adapter} Native Session 未声明支持按 Run 切换模型。请保持 ${previousModel}，或新建 Task 使用 ${selectedModel}。`);
}
