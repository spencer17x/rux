import { createHash, randomUUID } from "node:crypto";
import type {
  AgentAdapterInfo,
  AgentModelListParams,
  AgentModelListResult,
  PermissionDecideParams,
  PermissionDecision,
  PermissionRequest,
  RunStartParams,
  RuntimeEvent,
} from "../shared/protocol.ts";
import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterEvent,
  type CodexAppServerApprovalRequest,
  type CodexAppServerAdapterOptions,
} from "./codex-app-server-adapter.ts";

type CodexRuntimeAdapterOptions = CodexAppServerAdapterOptions & {
  /** Desktop can render these transient chunks; persistent/headless clients opt in explicitly. */
  forwardAssistantMessageDeltas?: boolean;
};

type ProviderRequestId = string | number;

type PendingApproval = {
  genericRequest: PermissionRequest;
  providerRequestId: ProviderRequestId;
  source: PermissionDecision["source"];
};

function providerKey(value: ProviderRequestId): string {
  return `${typeof value}:${String(value)}`;
}

function providerRequestLabel(value: ProviderRequestId): string {
  const label = providerKey(value);
  if (label.length <= 240) return label;
  return `${typeof value}:sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

function clipped(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(1, maximum - 1))}…`;
}

function genericAction(request: CodexAppServerApprovalRequest): PermissionRequest["action"] {
  if (request.action === "command.execute") return "command.execute";
  if (request.action === "network.access") return "network.access";
  if (request.action === "file.change") return "file.write";
  if (request.requestedPermissions?.network?.enabled === true) return "network.access";
  return "tool.execute";
}

function toolName(request: CodexAppServerApprovalRequest): string {
  if (request.kind === "command") return request.action === "network.access" ? "Network command" : "Command";
  if (request.kind === "file-change") return "File change";
  return "Permission grant";
}

function scopePath(request: CodexAppServerApprovalRequest): string {
  const path = request.kind === "command" && request.command
    ? request.command
    : request.kind === "file-change" && request.changedPaths?.length
      ? request.changedPaths.join(", ")
      : request.scope;
  return clipped(path || "Rux provider request", 4_096);
}

/**
 * Runtime-facing Codex adapter.
 *
 * Codex app-server uses bidirectional provider request ids and richer events
 * than the language-neutral RUX protocol. This bridge keeps those ids private
 * to the privileged Runtime while exposing one persisted PermissionRequest and
 * PermissionDecision per provider-native approval to Desktop and TUI clients.
 */
export class CodexRuntimeAdapter {
  private readonly emit: (event: RuntimeEvent) => void;
  private readonly adapter: CodexAppServerAdapter;
  private readonly byGenericId = new Map<string, PendingApproval>();
  private readonly genericIdByProviderKey = new Map<string, string>();
  private readonly activeRunIds = new Set<string>();
  private readonly forwardAssistantMessageDeltas: boolean;

  constructor(
    workspaceRoot: string,
    emit: (event: RuntimeEvent) => void,
    options: CodexRuntimeAdapterOptions = {},
  ) {
    this.emit = emit;
    this.forwardAssistantMessageDeltas = options.forwardAssistantMessageDeltas === true;
    const { forwardAssistantMessageDeltas: _forwardAssistantMessageDeltas, ...adapterOptions } = options;
    this.adapter = new CodexAppServerAdapter(
      workspaceRoot,
      (event) => this.handleAdapterEvent(event),
      adapterOptions,
    );
  }

  info(): AgentAdapterInfo {
    return this.adapter.info();
  }

  listModels(params: AgentModelListParams): Promise<AgentModelListResult> {
    return this.adapter.listModels(params);
  }

  start(params: RunStartParams) {
    return this.adapter.start(params);
  }

  decide(params: PermissionDecideParams): boolean {
    const pending = this.byGenericId.get(params.requestId);
    if (!pending || pending.genericRequest.runId !== params.runId) return false;
    pending.source = "user";
    try {
      this.adapter.decide({
        runId: params.runId,
        requestId: pending.providerRequestId,
        decision: params.decision === "approved" ? "approved" : "denied",
      });
      return true;
    } catch (error) {
      pending.source = "runtime";
      throw error;
    }
  }

  cancel(runId: string): Promise<void> {
    return this.adapter.cancel(runId);
  }

  async dispose(): Promise<void> {
    await this.adapter.dispose();
    this.byGenericId.clear();
    this.genericIdByProviderKey.clear();
    this.activeRunIds.clear();
  }

  forceDispose(): void {
    this.adapter.forceDispose();
    this.byGenericId.clear();
    this.genericIdByProviderKey.clear();
    this.activeRunIds.clear();
  }

  private handleAdapterEvent(event: CodexAppServerAdapterEvent): void {
    if (event.type === "codex.approval.requested") {
      this.recordApprovalRequest(event.request);
      return;
    }
    if (event.type === "codex.approval.decided") {
      this.recordApprovalDecision(event.requestId, event.decision);
      return;
    }
    if (event.type === "codex.connection.warning") {
      for (const runId of this.activeRunIds) {
        this.emit({ type: "run.log", runId, level: "warning", message: event.message });
      }
      return;
    }
    if (event.type === "assistant.message.delta") {
      if (this.forwardAssistantMessageDeltas) this.emit(event);
      return;
    }
    if ([
      "assistant.reasoning-summary.delta",
      "activity.output.delta",
      "file.patch.updated",
      "turn.diff.updated",
    ].includes(event.type)) {
      // Final normalized messages, activities, verification evidence, and the
      // Run-owned Git patch are emitted separately; avoid persisting stream
      // fragments or provider-specific patch duplicates.
      return;
    }

    if (event.type === "run.started") this.activeRunIds.add(event.runId);
    if ("runId" in event && ["run.completed", "run.cancelled", "run.failed"].includes(event.type)) {
      this.activeRunIds.delete(event.runId);
    }
    this.emit(event as RuntimeEvent);
  }

  private recordApprovalRequest(request: CodexAppServerApprovalRequest): void {
    const key = providerKey(request.id);
    const existingId = this.genericIdByProviderKey.get(key);
    if (existingId) {
      this.emit({
        type: "run.log",
        runId: request.runId,
        level: "warning",
        message: `Rux 重复发送了仍待处理的权限请求 ${providerRequestLabel(request.id)}`,
      });
      return;
    }
    const genericRequest: PermissionRequest = {
      id: `permission-codex-${randomUUID()}`,
      runId: request.runId,
      action: genericAction(request),
      scope: {
        kind: "tool",
        path: scopePath(request),
        appliesTo: request.kind === "permissions" ? "this-run" : "single-action",
      },
      impact: clipped(request.impact, 2_000),
      provider: "codex",
      providerRequestId: providerRequestLabel(request.id),
      toolName: clipped(toolName(request), 240),
      requestedAt: request.requestedAt,
      status: "pending",
    };
    const pending: PendingApproval = {
      genericRequest,
      providerRequestId: request.id,
      source: "runtime",
    };
    this.byGenericId.set(genericRequest.id, pending);
    this.genericIdByProviderKey.set(key, genericRequest.id);
    this.emit({ type: "permission.requested", runId: request.runId, request: genericRequest });
  }

  private recordApprovalDecision(
    providerRequestId: ProviderRequestId,
    providerDecision: "approved" | "approved-for-session" | "denied" | "cancelled",
  ): void {
    const key = providerKey(providerRequestId);
    const genericId = this.genericIdByProviderKey.get(key);
    const pending = genericId ? this.byGenericId.get(genericId) : undefined;
    if (!pending || !genericId) return;
    this.byGenericId.delete(genericId);
    this.genericIdByProviderKey.delete(key);
    const decision: PermissionDecision = {
      id: `permission-decision-${randomUUID()}`,
      requestId: genericId,
      runId: pending.genericRequest.runId,
      decision: providerDecision === "approved" || providerDecision === "approved-for-session"
        ? "approved"
        : providerDecision === "denied" ? "denied" : "cancelled",
      source: pending.source,
      decidedAt: new Date().toISOString(),
    };
    this.emit({ type: "permission.decided", runId: decision.runId, decision });
  }
}
