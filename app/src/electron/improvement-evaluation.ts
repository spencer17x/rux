import { randomUUID } from "node:crypto";
import { ClaudeCodeAdapter } from "./claude-adapter.ts";
import { CodexRuntimeAdapter } from "./codex-runtime-adapter.ts";
import { builtInAgentRevisionAdapter, improvementEvaluationRecordSchema, improvementEvaluationRuntimeParamsSchema, type AgentRevision, type ImprovementEvaluationOutcome, type ImprovementEvaluationRecord, type RuntimeEvent } from "../shared/protocol.ts";
import { redactSensitiveText } from "./verification-evidence.ts";

type Variant = "baseline" | "candidate";

export function gradeImprovementEvaluation(cases: Array<{ id: string; holdout: boolean }>, outcomes: ImprovementEvaluationOutcome[]): { status: "passed" | "failed"; baselinePassed: number; candidatePassed: number; holdoutPassed: boolean } {
  const baselinePassed = outcomes.filter((item) => item.variant === "baseline" && item.passed).length;
  const candidatePassed = outcomes.filter((item) => item.variant === "candidate" && item.passed).length;
  const holdoutIds = new Set(cases.filter((item) => item.holdout).map((item) => item.id));
  const holdoutPassed = outcomes.filter((item) => item.variant === "candidate" && holdoutIds.has(item.caseId)).every((item) => item.passed);
  const status = candidatePassed === cases.length && candidatePassed >= baselinePassed && holdoutPassed ? "passed" : "failed";
  return { status, baselinePassed, candidatePassed, holdoutPassed };
}

async function runIsolatedPrompt(workspaceRoot: string, params: ReturnType<typeof improvementEvaluationRuntimeParamsSchema.parse>, caseId: string, prompt: string): Promise<{ text: string; durationMs: number; tokens?: number; costUsd?: number; model?: string }> {
  const runId = `improvement-eval-${randomUUID()}`;
  const startedAt = Date.now();
  let adapter: ClaudeCodeAdapter | CodexRuntimeAdapter | undefined;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await new Promise((resolve, reject) => {
      const messages: string[] = [];
      let terminal = false;
      let tokens: number | undefined;
      let model: string | undefined;
      let costUsd: number | undefined;
      const finish = (error?: Error) => {
        if (terminal) return;
        terminal = true;
        if (timeout) clearTimeout(timeout);
        if (error) reject(error);
        else {
          const text = messages.join("\n\n").trim();
          if (!text) reject(new Error(`Evaluator returned no output for case ${caseId}`));
          else resolve({ text: redactSensitiveText(text, 20_000).text, durationMs: Date.now() - startedAt, ...(tokens !== undefined ? { tokens } : {}), ...(costUsd !== undefined ? { costUsd } : {}), ...(model ? { model } : {}) });
        }
      };
      const receive = (event: RuntimeEvent) => {
        if (!("runId" in event) || event.runId !== runId) return;
        if (event.type === "assistant.message" && event.text.trim()) messages.push(event.text.trim());
        if (event.type === "run.metadata" && event.model) model = event.model;
        if (event.type === "run.usage" && event.usage.totalTokens !== undefined) tokens = event.usage.totalTokens;
        if (event.type === "activity.started" && ["read", "edit", "command", "tool"].includes(event.activity.kind)) finish(new Error("Evaluator attempted to use a tool in an isolated evaluation"));
        if (event.type === "permission.requested") finish(new Error("Evaluator requested permission in an isolated evaluation"));
        if (event.type === "run.failed") finish(new Error(event.error));
        if (event.type === "run.cancelled") finish(new Error("Evaluator was cancelled"));
        if (event.type === "run.completed") { costUsd = event.costUsd; finish(); }
      };
      timeout = setTimeout(() => finish(new Error(`Evaluation case ${caseId} timed out`)), 120_000);
      adapter = params.adapter === "codex"
        ? new CodexRuntimeAdapter(workspaceRoot, receive, { forwardAssistantMessageDeltas: false })
        : new ClaudeCodeAdapter(workspaceRoot, receive);
      const startParams = {
        runId,
        prompt,
        ...(params.model ? { model: params.model } : {}),
        ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
        permissionMode: "plan" as const,
        ...(params.profileId ? { profileId: params.profileId } : {}),
        agentRevisionId: params.evaluatorAgentRevisionId,
        contextFiles: [],
      };
      void (params.adapter === "codex"
        ? (adapter as CodexRuntimeAdapter).start({ ...startParams, adapter: "codex", ephemeral: true })
        : Promise.resolve((adapter as ClaudeCodeAdapter).start({ ...startParams, adapter: "claude-code", noSessionPersistence: true, disableTools: true })))
        .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    if (adapter) await adapter.dispose().catch(() => undefined);
  }
}

export async function runIsolatedImprovementEvaluation(workspaceRoot: string, input: unknown, resolveRevision: (revisionId: string) => AgentRevision | undefined = () => undefined): Promise<ImprovementEvaluationRecord> {
  let params = improvementEvaluationRuntimeParamsSchema.parse(input);
  if (params.profileId) {
    const revision = resolveRevision(params.evaluatorAgentRevisionId);
    if (!revision || revision.profileId !== params.profileId || !revision.enabled || revision.backend !== params.adapter) throw new Error("Improvement evaluator Agent Revision is unavailable or incompatible");
    params = { ...params, evaluatorInstructions: revision.instructions, ...(revision.model ? { model: revision.model } : {}), ...(revision.reasoningEffort ? { reasoningEffort: revision.reasoningEffort } : {}) };
  } else if (builtInAgentRevisionAdapter(params.evaluatorAgentRevisionId) !== params.adapter) {
    throw new Error("Improvement evaluator built-in Revision does not match its Engine");
  }
  const outcomes: ImprovementEvaluationOutcome[] = [];
  let totalTokens = 0;
  let usageReported = true;
  let totalCostUsd = 0;
  let costReported = true;
  let actualModel = params.model;
  for (const testCase of params.cases) {
    for (const variant of ["baseline", "candidate"] as const) {
      const prompt = [
        "Rux isolated A/B improvement evaluation. Do not use tools, files, network, permissions, or native sessions. Return only the response to the test input.",
        params.evaluatorInstructions ? `Pinned evaluator instructions:\n${params.evaluatorInstructions}` : "",
        variant === "candidate" ? `Candidate improvement instructions:\n${params.candidateContent}` : "Baseline variant: do not apply the candidate improvement instructions.",
        `Test input:\n${testCase.input}`,
      ].filter(Boolean).join("\n\n");
      const result = await runIsolatedPrompt(workspaceRoot, params, `${testCase.id}:${variant}`, prompt);
      if (result.tokens === undefined) usageReported = false;
      else totalTokens += result.tokens;
      if (result.costUsd === undefined) costReported = false;
      else totalCostUsd += result.costUsd;
      actualModel = result.model ?? actualModel;
      outcomes.push({ caseId: testCase.id, variant, passed: result.text.toLocaleLowerCase().includes(testCase.expectedIncludes.toLocaleLowerCase()), outputPreview: result.text.slice(0, 2_000), durationMs: result.durationMs, ...(result.tokens !== undefined ? { tokens: result.tokens } : {}) });
    }
  }
  const { status, baselinePassed, candidatePassed, holdoutPassed } = gradeImprovementEvaluation(params.cases, outcomes);
  return improvementEvaluationRecordSchema.parse({
    id: randomUUID(), candidateId: params.candidateId, projectId: params.projectId, status,
    evaluatorAgentId: params.evaluatorAgentId, evaluatorAgentRevisionId: params.evaluatorAgentRevisionId, evaluatorAdapter: params.adapter,
    ...(actualModel ? { model: actualModel } : {}), cases: params.cases, outcomes, baselinePassed, candidatePassed, holdoutPassed,
    ...(usageReported ? { totalTokens } : {}), tokenSource: usageReported ? "engine" : "unreported", ...(costReported ? { costUsd: totalCostUsd } : {}), costSource: costReported ? "engine" : "unreported", createdAt: new Date().toISOString(),
  });
}
