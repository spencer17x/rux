import { randomUUID } from "node:crypto";
import { ClaudeCodeAdapter } from "./claude-adapter.ts";
import { CodexRuntimeAdapter } from "./codex-runtime-adapter.ts";
import {
  builtInAgentRevisionAdapter,
  handoffSummaryGenerateResultSchema,
  handoffSummaryRuntimeParamsSchema,
  type AgentRevision,
  type HandoffSummaryGenerateResult,
  type RuntimeEvent,
} from "../shared/protocol.ts";

const activeOperations = new Set<string>();

export async function generateIsolatedHandoffSummary(
  workspaceRoot: string,
  input: unknown,
  resolveRevision: (revisionId: string) => AgentRevision | undefined,
): Promise<HandoffSummaryGenerateResult> {
  const params = handoffSummaryRuntimeParamsSchema.parse(input);
  if (activeOperations.has(params.operationId)) throw new Error("Handoff summary operation is already active");
  if (params.providerConnection.engine !== params.adapter) throw new Error("Handoff source Connection uses the wrong Engine");

  let instructions = "";
  if (params.profileId) {
    const revision = resolveRevision(params.agentRevisionId);
    if (!revision || revision.profileId !== params.profileId || !revision.enabled) throw new Error("Handoff source Agent Revision is unavailable");
    if (revision.backend !== params.adapter || revision.providerConnection.id !== params.providerConnection.id) {
      throw new Error("Handoff source Agent Revision does not match its Engine and Connection");
    }
    instructions = revision.instructions.trim();
  } else if (builtInAgentRevisionAdapter(params.agentRevisionId) !== params.adapter) {
    throw new Error("Handoff source built-in Agent Revision does not match its Engine");
  }

  activeOperations.add(params.operationId);
  const runId = `handoff-summary-${randomUUID()}`;
  let adapter: ClaudeCodeAdapter | CodexRuntimeAdapter | undefined;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const summary = await new Promise<string>((resolveSummary, rejectSummary) => {
      const messages: string[] = [];
      let terminal = false;
      const finish = (error?: Error) => {
        if (terminal) return;
        terminal = true;
        if (timeout) clearTimeout(timeout);
        if (error) rejectSummary(error);
        else {
          const text = messages.join("\n\n").trim();
          if (!text) rejectSummary(new Error("Source Agent returned no handoff summary"));
          else resolveSummary(text.slice(0, 100_000));
        }
      };
      const receive = (event: RuntimeEvent) => {
        if (!("runId" in event) || event.runId !== runId) return;
        if (event.type === "assistant.message" && event.text.trim()) messages.push(event.text.trim());
        if (event.type === "activity.started" && ["read", "edit", "command", "tool"].includes(event.activity.kind)) {
          finish(new Error("Source Agent attempted to use workspace or tool context during isolated summary generation"));
        }
        if (event.type === "permission.requested") finish(new Error("Source Agent requested a tool permission during isolated summary generation"));
        if (event.type === "run.failed") finish(new Error(event.error));
        if (event.type === "run.cancelled") finish(new Error("Handoff summary generation was cancelled"));
        if (event.type === "run.completed") finish();
      };
      timeout = setTimeout(() => finish(new Error("Handoff summary generation timed out")), 120_000);
      adapter = params.adapter === "codex"
        ? new CodexRuntimeAdapter(workspaceRoot, receive, { forwardAssistantMessageDeltas: false })
        : new ClaudeCodeAdapter(workspaceRoot, receive);
      const prompt = [instructions ? `Pinned source Agent instructions:\n${instructions}` : "", params.prompt]
        .filter(Boolean).join("\n\n");
      const startParams = {
        runId,
        prompt,
        ...(params.model ? { model: params.model } : {}),
        ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
        permissionMode: "plan" as const,
        ...(params.profileId ? { profileId: params.profileId } : {}),
        agentRevisionId: params.agentRevisionId,
        contextFiles: [],
      };
      void (params.adapter === "codex"
        ? (adapter as CodexRuntimeAdapter).start({ ...startParams, adapter: "codex", ephemeral: true })
        : Promise.resolve((adapter as ClaudeCodeAdapter).start({ ...startParams, adapter: "claude-code", noSessionPersistence: true, disableTools: true })))
        .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
    });
    return handoffSummaryGenerateResultSchema.parse({
      generationId: params.operationId,
      summary,
      provenance: {
        sourceAgentRevisionId: params.agentRevisionId,
        sourceAdapter: params.adapter,
        generatedAt: new Date().toISOString(),
        isolated: true,
        nativeSessionPersisted: false,
      },
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    activeOperations.delete(params.operationId);
    if (adapter) await adapter.dispose().catch(() => undefined);
  }
}
