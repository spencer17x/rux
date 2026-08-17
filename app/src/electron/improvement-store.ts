import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ImprovementAsset,
  ImprovementCandidate,
  ImprovementDecideParams,
  ImprovementEvidence,
  ImprovementSettings,
  ImprovementSummary,
  ImprovementAdoption,
  ImprovementEvaluationRecord,
  ImprovementBudgetUsage,
  PersistedTask,
} from "../shared/protocol.ts";
import { improvementDecideParamsSchema } from "../shared/protocol.ts";
import { improvementSettingsUpdateParamsSchema, type ImprovementSettingsUpdateParams } from "../shared/protocol.ts";
import { improvementProposeParamsSchema, type ImprovementProposeParams } from "../shared/protocol.ts";
import { redactSensitiveText } from "./verification-evidence.ts";

type StoredImprovementState = {
  version: 1;
  settings: ImprovementSettings;
  evidence: ImprovementEvidence[];
  candidates: ImprovementCandidate[];
  assets: ImprovementAsset[];
  adoptions: ImprovementAdoption[];
  evaluations: ImprovementEvaluationRecord[];
  reservations: Array<{ id: string; date: string; projectId: string; tokens: number; costUsd: number; status: "reserved" | "completed" | "failed" }>;
  updatedAt: string;
};

const defaultSettings = (): ImprovementSettings => ({
  evidenceCollection: true,
  candidateGeneration: true,
  controlledEvolution: true,
  backgroundModelReview: true,
  paused: false,
  dailyTokenLimit: 0,
  perProjectTokenLimit: 0,
  evaluationTokenReservation: 20_000,
  evaluationCostReservationUsd: 0,
  onlyWhenIdle: true,
  onlyOnAcPower: false,
});

function emptyState(): StoredImprovementState {
  return { version: 1, settings: defaultSettings(), evidence: [], candidates: [], assets: [], adoptions: [], evaluations: [], reservations: [], updatedAt: new Date().toISOString() };
}

function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function safePreview(value: string, maximumLength = 320): string {
  return redactSensitiveText(value.replace(/\s+/g, " ").trim(), maximumLength).text;
}

function explicitFeedback(message: string): boolean {
  return /(以后(?:都|请)|记住(?:这个|这条|以后)|总是(?:先|要|使用)|不要再|形成(?:规则|流程)|沉淀(?:为|成))/i.test(message);
}

export class ImprovementStore {
  readonly #filePath: string;
  #state: StoredImprovementState;
  #loadError: Error | undefined;

  constructor(filePath: string) {
    this.#filePath = filePath;
    this.#state = this.#load();
  }

  summary(projectId?: string): ImprovementSummary {
    this.#assertWritable();
    const evidence = projectId ? this.#state.evidence.filter((item) => item.projectId === projectId) : this.#state.evidence;
    const candidates = projectId ? this.#state.candidates.filter((item) => !item.projectId || item.projectId === projectId) : this.#state.candidates;
    const assets = projectId ? this.#state.assets.filter((item) => !item.projectId || item.projectId === projectId) : this.#state.assets;
    const adoptions = projectId ? this.#state.adoptions.filter((item) => item.projectId === projectId) : this.#state.adoptions;
    const evaluations = projectId ? this.#state.evaluations.filter((item) => item.projectId === projectId) : this.#state.evaluations;
    const budgetUsage = this.#budgetUsage(projectId);
    return { settings: { ...this.#state.settings }, evidence: structuredClone(evidence), candidates: structuredClone(candidates), assets: structuredClone(assets), adoptions: structuredClone(adoptions), evaluations: structuredClone(evaluations), budgetUsage, pendingCount: candidates.filter((candidate) => candidate.status === "pending").length, updatedAt: this.#state.updatedAt };
  }

  analyze(projectId: string, tasks: PersistedTask[]): ImprovementSummary {
    this.#assertWritable();
    if (this.#state.settings.paused || !this.#state.settings.evidenceCollection) return this.summary(projectId);
    const now = new Date().toISOString();
    const knownEvidence = new Set(this.#state.evidence.map((item) => item.fingerprint));
    const knownCandidates = new Set(this.#state.candidates.map((item) => item.evidenceIds.join(":")));
    const additions: ImprovementEvidence[] = [];
    let adoptionChanged = false;

    for (const task of tasks) {
      for (const asset of task.improvementAssets ?? []) {
        const existingIndex = this.#state.adoptions.findIndex((adoption) => adoption.assetId === asset.id && adoption.taskId === task.id);
        const adoption: ImprovementAdoption = {
          assetId: asset.id, taskId: task.id, projectId, adoptedAt: task.createdAt ?? now,
          completedRunCount: task.runs.filter((run) => run.status === "completed").length,
          failedRunCount: task.runs.filter((run) => run.status === "failed").length,
          stoppedRunCount: task.runs.filter((run) => ["cancelled", "interrupted"].includes(run.status)).length,
          lastObservedAt: now,
        };
        if (existingIndex < 0) { this.#state.adoptions.push(adoption); adoptionChanged = true; }
        else if (JSON.stringify(this.#state.adoptions[existingIndex]) !== JSON.stringify(adoption)) { this.#state.adoptions[existingIndex] = adoption; adoptionChanged = true; }
      }
      for (const message of task.messages) {
        if (message.role !== "user" || !explicitFeedback(message.text)) continue;
        const evidenceFingerprint = fingerprint("explicit-feedback", projectId, task.id, message.id, message.text);
        if (knownEvidence.has(evidenceFingerprint)) continue;
        additions.push({ id: randomUUID(), kind: "explicit-feedback", projectId, taskId: task.id, preview: safePreview(message.text), fingerprint: evidenceFingerprint, occurredAt: message.createdAt ?? task.updatedAtIso ?? now });
        knownEvidence.add(evidenceFingerprint);
      }
      const failedRun = task.runs.find((run) => run.status === "failed");
      const completedAfterFailure = failedRun && task.runs.find((run) => run.status === "completed" && run.startedAt > failedRun.startedAt);
      if (failedRun && completedAfterFailure) {
        const evidenceFingerprint = fingerprint("recovery-pattern", projectId, task.id, failedRun.id, completedAfterFailure.id);
        if (!knownEvidence.has(evidenceFingerprint)) {
          additions.push({ id: randomUUID(), kind: "recovery-pattern", projectId, taskId: task.id, runId: completedAfterFailure.id, preview: `Task「${safePreview(task.title, 120)}」在失败后通过后续 Run 恢复并完成。`, fingerprint: evidenceFingerprint, occurredAt: completedAfterFailure.finishedAt ?? completedAfterFailure.updatedAt });
          knownEvidence.add(evidenceFingerprint);
        }
      }
    }

    this.#state.evidence.push(...additions);
    if (this.#state.settings.candidateGeneration) {
      for (const evidence of additions) {
        if (knownCandidates.has(evidence.id)) continue;
        const explicit = evidence.kind === "explicit-feedback";
        this.#state.candidates.push({
          id: randomUUID(),
          revision: 1,
          type: "project-rule",
          status: "pending",
          scope: "project",
          projectId,
          name: explicit ? `来自明确反馈的项目规则` : `复用已验证的失败恢复路径`,
          content: explicit ? evidence.preview : `处理与「${evidence.preview}」相似的任务时，先复核来源 Run 的失败原因与最终通过的确定性验证，再决定是否复用该恢复步骤。`,
          rationale: explicit ? "用户在 Task 中明确要求把做法用于后续工作。" : "同一 Task 存在失败后恢复成功的可审查 Run 证据。",
          expectedBenefit: explicit ? "减少重复纠正并保持项目内执行习惯一致。" : "缩短同类失败的恢复时间，同时保留重新验证门禁。",
          risk: "规则可能只适用于来源 Task；发布前应确认适用范围，且不得扩大权限或复制任务特有 Secret。",
          proposer: { kind: "deterministic", source: "local-evidence-rules/v1" },
          evidenceIds: [evidence.id],
          createdAt: now,
        });
        knownCandidates.add(evidence.id);
      }
    }
    if (additions.length || adoptionChanged) {
      this.#state.updatedAt = now;
      this.#persist();
    }
    return this.summary(projectId);
  }

  decide(input: ImprovementDecideParams): ImprovementSummary {
    this.#assertWritable();
    const params = improvementDecideParamsSchema.parse(input);
    const candidateIndex = this.#state.candidates.findIndex((candidate) => candidate.id === params.candidateId);
    if (candidateIndex < 0) throw new Error("IMPROVEMENT_CANDIDATE_MISSING: Candidate no longer exists");
    const candidate = this.#state.candidates[candidateIndex];
    const now = new Date().toISOString();
    if (params.action === "publish") {
      if (candidate.status !== "pending" && candidate.status !== "snoozed") throw new Error("IMPROVEMENT_STATE_INVALID: Only pending candidates can be published");
      if (!this.#state.settings.controlledEvolution) throw new Error("IMPROVEMENT_DISABLED: Controlled evolution is disabled");
      const validated = this.validatePublication(candidate.id, params.editedContent);
      const assetContent = validated.content;
      const evaluation = { ...validated.evaluation, evaluatedAt: now };
      const assetVersion = 1 + this.#state.assets.filter((asset) => asset.type === candidate.type && asset.scope === candidate.scope && asset.name === candidate.name && asset.projectId === candidate.projectId && asset.agentRevisionId === candidate.agentRevisionId).reduce((maximum, asset) => Math.max(maximum, asset.version), 0);
      this.#state.assets = this.#state.assets.map((asset) => asset.type === candidate.type && asset.scope === candidate.scope && asset.name === candidate.name && asset.projectId === candidate.projectId && asset.agentRevisionId === candidate.agentRevisionId && asset.status === "active" ? { ...asset, status: "superseded" as const, supersededAt: now } : asset);
      const asset: ImprovementAsset = {
        id: randomUUID(), candidateId: candidate.id, type: candidate.type, scope: candidate.scope,
        ...(candidate.projectId ? { projectId: candidate.projectId } : {}), ...(candidate.agentRevisionId ? { agentRevisionId: candidate.agentRevisionId } : {}),
        version: assetVersion, name: candidate.name, content: assetContent, status: "active", createdAt: now, formatVersion: 1, storage: "rux-managed", evaluation,
      };
      this.#state.assets.push(asset);
      this.#state.candidates[candidateIndex] = { ...candidate, revision: candidate.revision + (params.editedContent && params.editedContent.trim() !== candidate.content ? 1 : 0), content: asset.content, status: "published", decidedAt: now, publishedAssetId: asset.id, evaluation };
    } else if (params.action === "rollback") {
      if (!candidate.publishedAssetId) throw new Error("IMPROVEMENT_STATE_INVALID: Candidate has no published asset");
      const assetIndex = this.#state.assets.findIndex((asset) => asset.id === candidate.publishedAssetId && asset.status === "active");
      if (assetIndex < 0) throw new Error("IMPROVEMENT_STATE_INVALID: Published asset is already inactive");
      this.#state.assets[assetIndex] = { ...this.#state.assets[assetIndex], status: "rolled-back", rolledBackAt: now };
      const rolledBackAsset = this.#state.assets[assetIndex];
      const previous = this.#state.assets.filter((asset) => asset.type === rolledBackAsset.type && asset.scope === rolledBackAsset.scope && asset.name === rolledBackAsset.name && asset.projectId === rolledBackAsset.projectId && asset.agentRevisionId === rolledBackAsset.agentRevisionId && asset.status === "superseded" && asset.version < rolledBackAsset.version).sort((left, right) => right.version - left.version)[0];
      if (previous) this.#state.assets = this.#state.assets.map((asset) => asset.id === previous.id ? { ...asset, status: "active" as const, supersededAt: undefined } : asset);
      this.#state.candidates[candidateIndex] = { ...candidate, status: "rolled-back", decidedAt: now };
    } else if (params.action === "reject") {
      this.#state.candidates[candidateIndex] = { ...candidate, status: "rejected", decidedAt: now, rejectionReason: params.reason?.trim() || "用户拒绝" };
    } else {
      this.#state.candidates[candidateIndex] = { ...candidate, status: "snoozed", decidedAt: now };
    }
    this.#state.updatedAt = now;
    this.#persist();
    return this.summary(candidate.projectId);
  }

  updateSettings(input: ImprovementSettingsUpdateParams): ImprovementSummary {
    this.#assertWritable();
    const params = improvementSettingsUpdateParamsSchema.parse(input);
    const { evaluatorAgentId, dailyCostUsdLimit, ...patch } = params.patch;
    this.#state.settings = {
      ...this.#state.settings,
      ...patch,
      ...(evaluatorAgentId === null ? { evaluatorAgentId: undefined } : evaluatorAgentId !== undefined ? { evaluatorAgentId } : {}),
      ...(dailyCostUsdLimit === null ? { dailyCostUsdLimit: undefined } : dailyCostUsdLimit !== undefined ? { dailyCostUsdLimit } : {}),
    };
    this.#state.updatedAt = new Date().toISOString();
    this.#persist();
    return this.summary();
  }

  getCandidate(id: string): ImprovementCandidate | undefined {
    const candidate = this.#state.candidates.find((item) => item.id === id);
    return candidate ? structuredClone(candidate) : undefined;
  }

  validatePublication(candidateId: string, editedContent?: string): { content: string; evaluation: { status: "passed" | "unknown"; checks: string[]; evidenceCount: number; evaluatedAt: string } } {
    const candidate = this.#state.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("IMPROVEMENT_CANDIDATE_MISSING: Candidate no longer exists");
    const latestEvaluation = this.#state.evaluations.filter((item) => item.candidateId === candidateId).at(-1);
    if (latestEvaluation?.status === "failed") throw new Error("IMPROVEMENT_EVALUATION_FAILED: Latest isolated evaluation failed; revise and evaluate a new Candidate Revision");
    const content = editedContent?.trim() || candidate.content;
    const secretCheck = redactSensitiveText(content);
    if (secretCheck.redacted) throw new Error("IMPROVEMENT_SAFETY_GATE_FAILED: Candidate content contains credential-like material");
    if (/(danger-full-access|绕过.{0,12}(?:权限|审批|沙箱)|读取.{0,12}未授权|禁用.{0,12}(?:权限|沙箱)|复制.{0,12}(?:凭据|token|密钥))/i.test(content)) throw new Error("IMPROVEMENT_SAFETY_GATE_FAILED: Candidate would weaken a permission, sandbox, or credential boundary");
    return {
      content,
      evaluation: {
        status: candidate.type === "project-rule" || candidate.type === "agent-instruction" ? "passed" : "unknown",
        checks: ["content-nonempty", "credential-scan", "permission-boundary", "scope-pinned", "human-confirmed", ...(candidate.type === "project-rule" || candidate.type === "agent-instruction" ? ["deterministic-instruction-format"] : ["isolated-executable-evaluation-not-reported"])],
        evidenceCount: candidate.evidenceIds.length,
        evaluatedAt: new Date().toISOString(),
      },
    };
  }

  propose(input: ImprovementProposeParams, target?: { agentProfileId: string; agentRevisionId: string }): ImprovementSummary {
    this.#assertWritable();
    const params = improvementProposeParamsSchema.parse(input);
    const now = new Date().toISOString();
    const evidence: ImprovementEvidence = {
      id: randomUUID(), kind: "explicit-feedback", projectId: params.projectId, taskId: "manual-proposal",
      preview: safePreview(`用户手动提出 ${params.type}：${params.name}`), fingerprint: fingerprint("manual-proposal", params.projectId, params.type, params.scope, params.name, params.content), occurredAt: now,
    };
    const duplicate = this.#state.evidence.find((item) => item.fingerprint === evidence.fingerprint);
    if (duplicate) return this.summary(params.projectId);
    this.#state.evidence.push(evidence);
    this.#state.candidates.push({
      id: randomUUID(), revision: 1, type: params.type, status: "pending", scope: params.scope,
      ...(params.scope === "project" || params.type === "agent-instruction" ? { projectId: params.projectId } : {}),
      ...(params.type === "agent-instruction" && target ? { agentProfileId: target.agentProfileId, agentRevisionId: target.agentRevisionId } : {}),
      name: params.name, content: params.content,
      rationale: "用户在改进中心显式创建候选；仍需单独审批后才能发布。",
      expectedBenefit: params.expectedBenefit?.trim() || "把当前做法沉淀为可复用、可版本化并可回滚的资产。",
      risk: params.risk?.trim() || "内容可能过度拟合当前项目；发布前需要检查 Secret、权限变化和适用范围。",
      proposer: { kind: "user", source: "improvement-center" },
      evidenceIds: [evidence.id], createdAt: now,
    });
    this.#state.updatedAt = now;
    this.#persist();
    return this.summary(params.projectId);
  }

  publishAgentInstruction(candidateId: string, publishedAgentRevisionId: string, editedContent?: string): ImprovementSummary {
    this.#assertWritable();
    const candidateIndex = this.#state.candidates.findIndex((candidate) => candidate.id === candidateId);
    if (candidateIndex < 0) throw new Error("IMPROVEMENT_CANDIDATE_MISSING: Candidate no longer exists");
    const candidate = this.#state.candidates[candidateIndex];
    if (candidate.type !== "agent-instruction" || !candidate.agentProfileId || !candidate.agentRevisionId) throw new Error("IMPROVEMENT_STATE_INVALID: Candidate is not bound to an Agent Revision");
    if (!["pending", "snoozed"].includes(candidate.status)) throw new Error("IMPROVEMENT_STATE_INVALID: Only pending candidates can be published");
    const { content, evaluation } = this.validatePublication(candidateId, editedContent);
    const now = new Date().toISOString();
    const asset: ImprovementAsset = {
      id: randomUUID(), candidateId: candidate.id, type: candidate.type, scope: "agent", projectId: candidate.projectId, agentProfileId: candidate.agentProfileId,
      agentRevisionId: publishedAgentRevisionId, version: 1, name: candidate.name, content, status: "active", createdAt: now,
      formatVersion: 1, storage: "rux-managed", evaluation: { ...evaluation, evaluatedAt: now },
    };
    this.#state.assets.push(asset);
    this.#state.candidates[candidateIndex] = { ...candidate, content, status: "published", decidedAt: now, publishedAssetId: asset.id, publishedAgentRevisionId, evaluation: asset.evaluation };
    this.#state.updatedAt = now;
    this.#persist();
    return this.summary(candidate.projectId);
  }

  rollbackAgentInstruction(candidateId: string, rollbackAgentRevisionId: string): ImprovementSummary {
    this.decide({ candidateId, action: "rollback", confirmed: true });
    const index = this.#state.candidates.findIndex((candidate) => candidate.id === candidateId);
    if (index < 0) throw new Error("IMPROVEMENT_CANDIDATE_MISSING: Candidate no longer exists");
    this.#state.candidates[index] = { ...this.#state.candidates[index], rollbackAgentRevisionId };
    this.#state.updatedAt = new Date().toISOString();
    this.#persist();
    return this.summary(this.#state.candidates[index].projectId);
  }

  reserveEvaluation(projectId: string): { id: string; tokens: number } {
    this.#assertWritable();
    const settings = this.#state.settings;
    if (settings.paused || !settings.controlledEvolution) throw new Error("IMPROVEMENT_DISABLED: Controlled evolution is paused or disabled");
    if (settings.dailyTokenLimit <= 0 || settings.perProjectTokenLimit <= 0) throw new Error("IMPROVEMENT_BUDGET_REQUIRED: Configure daily and per-Project Token budgets before evaluation");
    const date = new Date().toISOString().slice(0, 10);
    const today = this.#state.reservations.filter((item) => item.date === date);
    const dailyReserved = today.reduce((sum, item) => sum + item.tokens, 0);
    const projectReserved = today.filter((item) => item.projectId === projectId).reduce((sum, item) => sum + item.tokens, 0);
    const dailyCostReserved = today.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
    const tokens = settings.evaluationTokenReservation;
    if (dailyReserved + tokens > settings.dailyTokenLimit) throw new Error("IMPROVEMENT_BUDGET_EXCEEDED: Daily Token budget would be exceeded");
    if (projectReserved + tokens > settings.perProjectTokenLimit) throw new Error("IMPROVEMENT_BUDGET_EXCEEDED: Project Token budget would be exceeded");
    if (settings.dailyCostUsdLimit !== undefined && (settings.evaluationCostReservationUsd <= 0 || dailyCostReserved + settings.evaluationCostReservationUsd > settings.dailyCostUsdLimit)) throw new Error("IMPROVEMENT_BUDGET_EXCEEDED: Configure a positive per-evaluation USD reservation within the daily cost limit");
    const id = randomUUID();
    this.#state.reservations.push({ id, date, projectId, tokens, costUsd: settings.evaluationCostReservationUsd, status: "reserved" });
    this.#state.updatedAt = new Date().toISOString();
    this.#persist();
    return { id, tokens };
  }

  recordEvaluation(reservationId: string, record: ImprovementEvaluationRecord): ImprovementSummary {
    const reservation = this.#state.reservations.find((item) => item.id === reservationId && item.status === "reserved");
    if (!reservation || reservation.projectId !== record.projectId) throw new Error("IMPROVEMENT_EVALUATION_RESERVATION_INVALID: Evaluation reservation is missing or mismatched");
    reservation.status = "completed";
    if (record.totalTokens !== undefined) reservation.tokens = Math.max(reservation.tokens, record.totalTokens);
    if (record.costUsd !== undefined) reservation.costUsd = Math.max(reservation.costUsd, record.costUsd);
    this.#state.evaluations.push(structuredClone(record));
    const candidateIndex = this.#state.candidates.findIndex((candidate) => candidate.id === record.candidateId);
    if (candidateIndex >= 0) {
      const candidate = this.#state.candidates[candidateIndex];
      const sameModelOnly = candidate.proposer.kind === "model" && candidate.proposer.model && candidate.proposer.model === record.model;
      this.#state.candidates[candidateIndex] = { ...candidate, evaluation: { status: sameModelOnly && record.status === "passed" ? "unknown" : record.status, checks: ["isolated-baseline-candidate", "holdout-regression", "deterministic-output-grader", `token-${record.tokenSource}`, ...(sameModelOnly ? ["same-model-review-advisory-only"] : [])], evidenceCount: candidate.evidenceIds.length, evaluatedAt: record.createdAt } };
    }
    this.#state.updatedAt = new Date().toISOString();
    this.#persist();
    return this.summary(record.projectId);
  }

  failEvaluation(reservationId: string): void {
    const reservation = this.#state.reservations.find((item) => item.id === reservationId && item.status === "reserved");
    if (!reservation) return;
    reservation.status = "failed";
    this.#state.updatedAt = new Date().toISOString();
    this.#persist();
  }

  #budgetUsage(projectId?: string): ImprovementBudgetUsage[] {
    const keys = new Map<string, ImprovementBudgetUsage>();
    for (const reservation of this.#state.reservations) {
      if (projectId && reservation.projectId !== projectId) continue;
      const key = `${reservation.date}:${reservation.projectId}`;
      const current = keys.get(key) ?? { date: reservation.date, projectId: reservation.projectId, reservedTokens: 0, reportedTokens: 0, reservedCostUsd: 0, evaluations: 0 };
      current.reservedTokens += reservation.tokens;
      current.reservedCostUsd += reservation.costUsd ?? 0;
      if (reservation.status === "completed") current.evaluations += 1;
      keys.set(key, current);
    }
    for (const evaluation of this.#state.evaluations) {
      const date = evaluation.createdAt.slice(0, 10);
      const key = `${date}:${evaluation.projectId}`;
      const current = keys.get(key);
      if (!current) continue;
      current.reportedTokens += evaluation.totalTokens ?? 0;
      if (evaluation.costUsd !== undefined) current.reportedCostUsd = (current.reportedCostUsd ?? 0) + evaluation.costUsd;
    }
    return [...keys.values()].sort((left, right) => right.date.localeCompare(left.date) || left.projectId.localeCompare(right.projectId));
  }

  #assertWritable(): void { if (this.#loadError) throw this.#loadError; }

  #load(): StoredImprovementState {
    try {
      const parsed = JSON.parse(readFileSync(this.#filePath, "utf8")) as StoredImprovementState;
      if (parsed.version !== 1 || !parsed.settings || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.candidates) || !Array.isArray(parsed.assets)) throw new Error(`Unsupported Improvement Store version: ${String(parsed?.version ?? "missing")}`);
      return { ...parsed, settings: { ...defaultSettings(), ...parsed.settings }, candidates: parsed.candidates.map((candidate) => ({ ...candidate, proposer: candidate.proposer ?? { kind: "deterministic", source: "legacy-local-candidate" } })), adoptions: Array.isArray(parsed.adoptions) ? parsed.adoptions : [], evaluations: Array.isArray(parsed.evaluations) ? parsed.evaluations : [], reservations: Array.isArray(parsed.reservations) ? parsed.reservations.map((item) => ({ ...item, costUsd: item.costUsd ?? 0 })) : [] };
    } catch (error) {
      try { readFileSync(this.#filePath, "utf8"); this.#loadError = new Error(`Improvement Store is unreadable and was preserved: ${error instanceof Error ? error.message : String(error)}`); }
      catch (readError) { if ((readError as NodeJS.ErrnoException).code !== "ENOENT") this.#loadError = new Error(`Improvement Store cannot be read: ${String(readError)}`); }
      return emptyState();
    }
  }

  #persist(): void {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#filePath);
  }
}
