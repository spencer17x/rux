import { randomUUID } from "node:crypto";
import {
  permissionRequestSchema,
  type PermissionDecideParams,
  type PermissionDecision,
  type PermissionRequest,
  type RunAdapter,
  type RunStartParams,
  type RuntimeEvent,
} from "../shared/protocol.ts";
import { redactSensitiveText } from "./verification-evidence.ts";

export type PendingPermissionRun = {
  params: RunStartParams;
  request: PermissionRequest;
};

export type ProviderToolPermissionRequest = {
  provider: RunAdapter;
  providerRequestId: string;
  runId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type ProviderToolPermissionDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

type PendingProviderPermission = {
  request: PermissionRequest;
  input: Record<string, unknown>;
  signal: AbortSignal;
  onAbort: () => void;
  resolve: (decision: ProviderToolPermissionDecision) => void;
};

type LaunchResult = { runId: string; adapter: RunAdapter };
type LaunchRun = (params: RunStartParams) => Promise<LaunchResult> | LaunchResult;
type RecoverPendingRun = (
  runId: string,
  requestId: string,
) => Promise<PendingPermissionRun | undefined> | PendingPermissionRun | undefined;

export type PermissionStartResult = LaunchResult & {
  state: "running" | "waiting-permission";
};

export class PermissionGateError extends Error {
  readonly code: "PERMISSION_NOT_PENDING" | "PERMISSION_REQUEST_MISMATCH";

  constructor(
    code: PermissionGateError["code"],
    message: string,
  ) {
    super(message);
    this.name = "PermissionGateError";
    this.code = code;
  }
}

/**
 * RUX owns this coarse Run-scoped gate only for adapters that cannot surface
 * provider-native approvals. Codex app-server provides exact command, file,
 * and permission requests, so Codex Runs bypass this gate and rely on those
 * narrower approvals instead of asking twice.
 */
export class RunPermissionGate {
  private readonly pending = new Map<string, PendingPermissionRun>();
  private readonly providerPending = new Map<string, PendingProviderPermission>();
  private readonly workspaceRoot: string;
  private readonly emit: (event: RuntimeEvent) => void;
  private readonly launch: LaunchRun;
  private readonly recover?: RecoverPendingRun;
  private disposed = false;

  constructor(
    workspaceRoot: string,
    emit: (event: RuntimeEvent) => void,
    launch: LaunchRun,
    recover?: RecoverPendingRun,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.emit = emit;
    this.launch = launch;
    this.recover = recover;
  }

  async start(params: RunStartParams): Promise<PermissionStartResult> {
    if (this.disposed) throw new Error("Rux permission gate is stopped");
    if (params.adapter === "codex" || params.permissionMode !== "acceptEdits") {
      const launched = await this.launch(params);
      return { ...launched, state: "running" };
    }
    if (this.pending.has(params.runId)) {
      throw new PermissionGateError("PERMISSION_REQUEST_MISMATCH", "Run already has a pending permission request");
    }

    const request: PermissionRequest = {
      id: `permission-${randomUUID()}`,
      runId: params.runId,
      action: "workspace.write",
      scope: {
        kind: "workspace",
        path: this.workspaceRoot,
        appliesTo: "this-run",
      },
      impact: "允许此 Run 在已授权 Workspace 内创建、修改或删除文件并执行受底座策略约束的命令；不授予 Workspace 外访问。",
      requestedAt: new Date().toISOString(),
      status: "pending",
    };
    this.pending.set(params.runId, { params, request });
    this.emit({
      type: "permission.requested",
      runId: params.runId,
      adapter: params.adapter,
      prompt: params.prompt,
      permissionMode: "acceptEdits",
      ...(params.model ? { model: params.model } : {}),
      ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
      ...(params.profileId ? { profileId: params.profileId } : {}),
      contextFiles: params.contextFiles ?? [],
      request,
    });
    return { runId: params.runId, adapter: params.adapter, state: "waiting-permission" };
  }

  async decide(params: PermissionDecideParams): Promise<{
    ok: true;
    state: "running" | "cancelled" | "failed";
  }> {
    if (this.disposed) throw new Error("Rux permission gate is stopped");
    const providerPending = this.providerPending.get(params.requestId);
    if (providerPending) {
      if (providerPending.request.runId !== params.runId) {
        throw new PermissionGateError("PERMISSION_REQUEST_MISMATCH", "Permission request does not match the Run");
      }
      this.finishProviderPermission(
        providerPending,
        params.decision,
        "user",
        params.decision === "approved"
          ? { behavior: "allow", updatedInput: providerPending.input }
          : { behavior: "deny", message: "用户拒绝了这项 Claude Code 操作" },
      );
      return { ok: true, state: "running" };
    }

    const pending = await this.findPending(params.runId, params.requestId);
    this.pending.delete(params.runId);
    const decision = this.createDecision(pending.request, params.decision);
    this.emit({ type: "permission.decided", runId: params.runId, decision });

    if (params.decision === "denied") {
      this.emit({ type: "run.cancelled", runId: params.runId });
      return { ok: true, state: "cancelled" };
    }

    try {
      await this.launch(pending.params);
      return { ok: true, state: "running" };
    } catch (error) {
      this.emit({
        type: "run.failed",
        runId: params.runId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: true, state: "failed" };
    }
  }

  async cancel(runId: string): Promise<boolean> {
    for (const providerPending of [...this.providerPending.values()]) {
      if (providerPending.request.runId !== runId) continue;
      this.finishProviderPermission(
        providerPending,
        "cancelled",
        "runtime",
        { behavior: "deny", message: "Rux 已停止这个 Run" },
      );
    }
    const inMemory = this.pending.get(runId);
    const pending = inMemory ?? await this.recover?.(runId, "");
    if (!pending || pending.request.status !== "pending") return false;
    this.pending.delete(runId);
    const decision = this.createDecision(pending.request, "cancelled");
    this.emit({ type: "permission.decided", runId, decision });
    this.emit({ type: "run.cancelled", runId });
    return true;
  }

  requestProviderTool(
    input: ProviderToolPermissionRequest,
    signal: AbortSignal,
  ): Promise<ProviderToolPermissionDecision> {
    if (this.disposed) {
      return Promise.resolve({ behavior: "deny", message: "Rux Runtime is stopping" });
    }
    const requestId = `permission-${input.provider}-${randomUUID()}`;
    if (this.providerPending.has(requestId)) {
      return Promise.resolve({ behavior: "deny", message: "Duplicate provider permission request" });
    }
    const safeToolName = redactSensitiveText(input.toolName.trim(), 240).text || "Provider tool";
    const target = providerToolTarget(safeToolName, input.input);
    const request = permissionRequestSchema.parse({
      id: requestId,
      runId: input.runId,
      action: providerToolAction(safeToolName),
      scope: {
        kind: "tool",
        path: target,
        appliesTo: "single-action",
      },
      impact: redactSensitiveText(providerToolImpact(safeToolName, target), 2_000).text,
      provider: input.provider,
      providerRequestId: redactSensitiveText(input.providerRequestId, 240).text || "provider-request",
      toolName: safeToolName,
      requestedAt: new Date().toISOString(),
      status: "pending",
    }) as PermissionRequest;
    this.emit({ type: "permission.requested", runId: input.runId, request });

    return new Promise((resolve) => {
      const pending: PendingProviderPermission = {
        request,
        input: input.input,
        signal,
        onAbort: () => undefined,
        resolve,
      };
      pending.onAbort = () => {
        if (!this.providerPending.has(request.id)) return;
        this.finishProviderPermission(
          pending,
          "cancelled",
          "runtime",
          { behavior: "deny", message: "Provider permission request was cancelled" },
        );
      };
      this.providerPending.set(request.id, pending);
      if (signal.aborted) pending.onAbort();
      else signal.addEventListener("abort", pending.onAbort, { once: true });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const providerPending of [...this.providerPending.values()]) {
      this.finishProviderPermission(
        providerPending,
        "cancelled",
        "runtime",
        { behavior: "deny", message: "Rux Runtime is stopping" },
      );
    }
    for (const pending of this.pending.values()) {
      const decision = this.createDecision(pending.request, "cancelled", "runtime");
      this.emit({ type: "permission.decided", runId: pending.request.runId, decision });
      this.emit({ type: "run.cancelled", runId: pending.request.runId });
    }
    this.pending.clear();
  }

  private async findPending(runId: string, requestId: string): Promise<PendingPermissionRun> {
    const pending = this.pending.get(runId) ?? await this.recover?.(runId, requestId);
    if (!pending || pending.request.status !== "pending") {
      throw new PermissionGateError("PERMISSION_NOT_PENDING", "Permission request is no longer pending");
    }
    if (pending.request.id !== requestId || pending.request.runId !== runId) {
      throw new PermissionGateError("PERMISSION_REQUEST_MISMATCH", "Permission request does not match the Run");
    }
    return pending;
  }

  private createDecision(
    request: PermissionRequest,
    decision: PermissionDecision["decision"],
    source: PermissionDecision["source"] = "user",
  ): PermissionDecision {
    return {
      id: `permission-decision-${randomUUID()}`,
      requestId: request.id,
      runId: request.runId,
      decision,
      source,
      decidedAt: new Date().toISOString(),
    };
  }

  private finishProviderPermission(
    pending: PendingProviderPermission,
    decisionValue: PermissionDecision["decision"],
    source: PermissionDecision["source"],
    providerDecision: ProviderToolPermissionDecision,
  ): void {
    this.providerPending.delete(pending.request.id);
    pending.signal.removeEventListener("abort", pending.onAbort);
    const decision = this.createDecision(pending.request, decisionValue, source);
    this.emit({ type: "permission.decided", runId: pending.request.runId, decision });
    pending.resolve(providerDecision);
  }
}

function providerToolAction(toolName: string): PermissionRequest["action"] {
  if (toolName === "Bash") return "command.execute";
  if (["Edit", "Write", "NotebookEdit"].includes(toolName)) return "file.write";
  if (["WebFetch", "WebSearch"].includes(toolName)) return "network.access";
  return "tool.execute";
}

function providerToolTarget(toolName: string, input: Record<string, unknown>): string {
  const candidates = toolName === "Bash"
    ? [input.command, input.description]
    : [input.file_path, input.path, input.url, input.query, input.description];
  const target = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?? `${toolName} tool call`;
  return redactSensitiveText(target.trim(), 4_096).text || `${toolName} tool call`;
}

function providerToolImpact(toolName: string, target: string): string {
  if (toolName === "Bash") return `Claude Code 请求执行命令：${target}。批准只影响这一项操作。`;
  if (["Edit", "Write", "NotebookEdit"].includes(toolName)) {
    return `Claude Code 请求写入：${target}。批准只影响这一项操作。`;
  }
  if (["WebFetch", "WebSearch"].includes(toolName)) {
    return `Claude Code 请求网络访问：${target}。批准只影响这一项操作。`;
  }
  return `Claude Code 请求调用 ${toolName}：${target}。批准只影响这一项操作。`;
}
