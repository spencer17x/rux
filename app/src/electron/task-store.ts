import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  agentRevisionSchema,
  builtInAgentRevisionAdapter,
  builtInAgentRevisionId,
  defaultProviderConnectionForAdapter,
  defaultModelState,
  importedSessionBindingSchema,
  contextHandoffSnapshotSchema,
  contextHandoffFactBundleSchema,
  handoffCommitResultSchema,
  handoffPreviewResultSchema,
  handoffTargetSchema,
  localDataExecuteResultSchema,
  localDataImpactPreviewSchema,
  localDataPreviewParamsSchema,
  localDataSummarySchema,
  legacyProviderConnectionForAdapter,
  persistedWorkspaceIdSchema,
  sessionImportResultSchema,
  sessionProjectionAuditSchema,
  sessionProjectionDiffSchema,
  sessionProjectionRevisionSchema,
  sessionProjectionSchema,
  sessionRefreshResultSchema,
  sessionRevisionListResultSchema,
  workspaceTaskStateSchema,
  type AgentRevision,
  type ContextHandoffFactBundle,
  type ContextHandoffSnapshot,
  type HandoffCommitResult,
  type HandoffPreviewResult,
  type HandoffSummaryProvenance,
  type HandoffTarget,
  type LocalDataExecuteResult,
  type LocalDataExportFormat,
  type LocalDataImpactPreview,
  type LocalDataPreviewParams,
  type LocalDataRevisionScope,
  type LocalDataScope,
  type LocalDataSummary,
  type PersistedRun,
  type PersistedRunEvent,
  type PersistedTask,
  type PersistedTaskMessage,
  type SessionContentPart,
  type SessionImportMode,
  type SessionImportResult,
  type SessionMessage,
  type SessionPreviewResult,
  type SessionProjectionAudit,
  type SessionProjectionDiff,
  type SessionProjectionRevision,
  type SessionRefreshResult,
  type SessionRevisionListResult,
  type VerificationEvidence,
  type WorkspaceTaskState,
} from "../shared/protocol.ts";

type StoredWorkspaceRow = {
  state_json: string;
};

type StoredProjectionRow = {
  id: string;
  task_id: string;
  latest_revision_id: string;
  state_json: string;
  created_at: string;
};

type StoredProjectionRevisionRow = {
  id: string;
  revision_json: string;
};

type StoredAuditRow = { audit_json: string };
type StoredRevisionExportRow = { revision_json: string };
type StoredHandoffExportRow = { snapshot_json: string };

export interface LocalDataExportArtifact {
  suggestedName: string;
  mimeType: string;
  content: string;
}

type StoredWorkspaceMigrationRow = StoredWorkspaceRow & {
  workspace_id: string;
  updated_at: string;
};

type SchemaVersionRow = {
  user_version: number;
};

type TableInfoRow = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
};

type TableListRow = {
  name: string;
  type: string;
  strict: number;
};

const TASK_STORE_SCHEMA_VERSION = 5;

const expectedWorkspaceStateColumns = [
  { name: "workspace_id", type: "TEXT", notnull: 1, pk: 1 },
  { name: "state_json", type: "TEXT", notnull: 1, pk: 0 },
  { name: "updated_at", type: "TEXT", notnull: 1, pk: 0 },
] as const;

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function stringValue(object: UnknownRecord | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function legacyAdapter(task: UnknownRecord, run?: UnknownRecord): "claude-code" | "codex" | "rux-native" | "mock" {
  const candidate = stringValue(run, "adapter") ?? stringValue(task, "adapter");
  if (candidate === "claude-code" || candidate === "codex" || candidate === "rux-native" || candidate === "mock") return candidate;
  const agent = stringValue(task, "agent");
  if (agent === "Claude Code") return "claude-code";
  if (agent === "Codex" || agent === "Rux") return "codex";
  return "mock";
}

function legacyRevisionHash(scope: string): string {
  return createHash("sha256").update(scope).digest("hex");
}

function legacyRevision(
  scope: string,
  task: UnknownRecord,
  run: UnknownRecord | undefined,
  fallbackCreatedAt: string,
): AgentRevision | undefined {
  const adapter = legacyAdapter(task, run);
  if (adapter === "mock") return undefined;
  const snapshot = objectValue(run?.agentSnapshot);
  const profileId = stringValue(snapshot, "id")
    ?? stringValue(run, "profileId")
    ?? stringValue(task, "agentProfileId");
  if (!profileId && !snapshot) return undefined;

  const hash = legacyRevisionHash(scope);
  const name = (stringValue(snapshot, "name") ?? stringValue(task, "agent") ?? "Legacy Agent").slice(0, 80);
  const description = (stringValue(snapshot, "description") ?? "Migrated from a legacy Task snapshot").slice(0, 400);
  const instructions = (stringValue(snapshot, "instructions")
    ?? "Legacy migration: the original Agent instructions were not persisted.").slice(0, 20_000);
  const model = stringValue(snapshot, "model") ?? stringValue(run, "model") ?? stringValue(task, "model");
  const reasoningEffort = stringValue(snapshot, "reasoningEffort") ?? stringValue(run, "reasoningEffort")
    ?? stringValue(task, "reasoningEffort");
  const permissionCandidate = stringValue(snapshot, "permissionMode") ?? stringValue(run, "permissionMode")
    ?? stringValue(task, "permissionMode");
  const permissionMode = permissionCandidate === "plan" || permissionCandidate === "dontAsk"
    ? permissionCandidate
    : "acceptEdits";
  const skillIds = Array.isArray(snapshot?.skillIds)
    ? snapshot.skillIds.filter((value): value is string => typeof value === "string")
    : [];
  const toolIds = Array.isArray(snapshot?.toolIds)
    ? snapshot.toolIds.filter((value): value is string => typeof value === "string")
    : [];

  return agentRevisionSchema.parse({
    id: `legacy-agent-revision:${hash}`,
    profileId: profileId ?? `legacy-profile:${hash.slice(0, 32)}`,
    revisionNumber: 1,
    origin: "legacy-task",
    name,
    description,
    backend: adapter,
    providerConnection: legacyProviderConnectionForAdapter(adapter),
    ...(model ? { model } : {}),
    modelSource: "legacy",
    modelVerificationStatus: "legacy",
    ...(reasoningEffort ? { reasoningEffort } : {}),
    instructions,
    permissionMode,
    skillIds,
    toolIds,
    enabled: snapshot?.enabled !== false,
    createdAt: stringValue(snapshot, "updatedAt")
      ?? stringValue(snapshot, "createdAt")
      ?? stringValue(run, "startedAt")
      ?? stringValue(task, "createdAt")
      ?? fallbackCreatedAt,
  });
}

/** Deterministically upgrades one validated-or-validatable v1 JSON snapshot. */
export function migrateWorkspaceTaskStateV1(input: unknown): WorkspaceTaskState {
  const state = objectValue(input);
  if (!state) throw new Error("Legacy task state must be an object");
  if (state.version === 2) return workspaceTaskStateSchema.parse(state);
  if (state.version !== 1) throw new Error(`Unsupported workspace task state version: ${String(state.version)}`);
  const workspaceId = stringValue(state, "workspaceId");
  const updatedAt = stringValue(state, "updatedAt");
  if (!workspaceId || !updatedAt || !Array.isArray(state.tasks)) {
    throw new Error("Legacy task state is missing its workspace identity, timestamp, or tasks");
  }

  const tasks = state.tasks.map((taskInput, taskIndex) => {
    const task = objectValue(taskInput);
    if (!task) throw new Error(`Legacy task at index ${taskIndex} must be an object`);
    const taskId = stringValue(task, "id") ?? `index-${taskIndex}`;
    const legacyRuns = Array.isArray(task.runs) ? task.runs : [];
    const taskEvidenceRun = [...legacyRuns].reverse()
      .map(objectValue)
      .find((run) => run && (objectValue(run.agentSnapshot) || stringValue(run, "profileId")));
    const adapter = legacyAdapter(task, taskEvidenceRun);
    const taskSnapshot = legacyRevision(
      `${workspaceId}:${taskId}:task`,
      task,
      taskEvidenceRun,
      updatedAt,
    );
    const taskRevisionId = taskSnapshot?.id ?? builtInAgentRevisionId(adapter);
    const providerConnection = taskSnapshot?.providerConnection
      ?? defaultProviderConnectionForAdapter(adapter);
    const runs = legacyRuns.map((runInput, runIndex) => {
      const run = objectValue(runInput);
      if (!run) throw new Error(`Legacy Run at index ${runIndex} must be an object`);
      const runId = stringValue(run, "id") ?? `index-${runIndex}`;
      const runAdapter = legacyAdapter(task, run);
      const runSnapshot = legacyRevision(
        `${workspaceId}:${taskId}:run:${runId}`,
        task,
        run,
        updatedAt,
      );
      return {
        ...run,
        agentRevisionId: runSnapshot?.id ?? builtInAgentRevisionId(runAdapter),
        providerConnection: runSnapshot?.providerConnection
          ?? defaultProviderConnectionForAdapter(runAdapter),
        modelSource: "legacy",
        modelVerificationStatus: "legacy",
        ...(runSnapshot ? { agentSnapshot: runSnapshot } : {}),
      };
    });
    return {
      ...task,
      adapter,
      agentRevisionId: taskRevisionId,
      ...(taskSnapshot ? { agentRevisionSnapshot: taskSnapshot } : {}),
      providerConnection,
      modelSource: "legacy",
      modelVerificationStatus: "legacy",
      runs,
    };
  });

  return workspaceTaskStateSchema.parse({
    version: 2,
    workspaceId,
    tasks,
    updatedAt,
  });
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as SchemaVersionRow | undefined;
  const version = row?.user_version;
  if (!Number.isSafeInteger(version) || version === undefined || version < 0) {
    throw new Error("Task store has an invalid SQLite schema version");
  }
  return version;
}

function assertWorkspaceTaskStateSchema(database: DatabaseSync): void {
  const table = database
    .prepare("PRAGMA table_list('workspace_task_state')")
    .get() as TableListRow | undefined;
  if (!table || table.name !== "workspace_task_state" || table.type !== "table") {
    throw new Error("Task store schema is missing the workspace_task_state table");
  }
  if (table.strict !== 1) {
    throw new Error("Task store workspace_task_state table must use SQLite STRICT mode");
  }

  const columns = database
    .prepare("PRAGMA table_info(workspace_task_state)")
    .all() as unknown as TableInfoRow[];
  const compatible = columns.length === expectedWorkspaceStateColumns.length
    && expectedWorkspaceStateColumns.every((expected, index) => {
      const actual = columns[index];
      return actual?.name === expected.name
        && actual.type.toUpperCase() === expected.type
        && actual.notnull === expected.notnull
        && actual.pk === expected.pk;
    });
  if (!compatible) {
    throw new Error("Task store workspace_task_state table has an incompatible column layout");
  }
}

function assertSessionProjectionSchema(database: DatabaseSync): void {
  for (const name of ["session_projection", "session_projection_revision", "session_projection_audit"]) {
    const table = database.prepare(`PRAGMA table_list('${name}')`).get() as TableListRow | undefined;
    if (!table || table.name !== name || table.type !== "table" || table.strict !== 1) {
      throw new Error(`Task store schema is missing the STRICT ${name} table`);
    }
  }
}

function assertContextHandoffSchema(database: DatabaseSync): void {
  const table = database.prepare("PRAGMA table_list('context_handoff_snapshot')").get() as TableListRow | undefined;
  if (!table || table.name !== "context_handoff_snapshot" || table.type !== "table" || table.strict !== 1) {
    throw new Error("Task store schema is missing the STRICT context_handoff_snapshot table");
  }
}

function migrateFromVersion(database: DatabaseSync, version: number): number {
  if (version === 0) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_task_state (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
    database.exec("PRAGMA user_version = 1");
    return 1;
  }
  if (version === 1) {
    assertWorkspaceTaskStateSchema(database);
    const rows = database.prepare(`
      SELECT workspace_id, state_json, updated_at FROM workspace_task_state
    `).all() as unknown as StoredWorkspaceMigrationRow[];
    const update = database.prepare(`
      UPDATE workspace_task_state SET state_json = ?, updated_at = ? WHERE workspace_id = ?
    `);
    for (const row of rows) {
      let legacy: unknown;
      try {
        legacy = JSON.parse(row.state_json) as unknown;
      } catch (error) {
        throw new Error(`Stored task state for workspace ${row.workspace_id} is not valid JSON`, { cause: error });
      }
      const migrated = migrateWorkspaceTaskStateV1(legacy);
      if (migrated.workspaceId !== row.workspace_id) {
        throw new Error(`Stored task state workspace mismatch: expected ${row.workspace_id}`);
      }
      update.run(JSON.stringify(migrated), migrated.updatedAt, row.workspace_id);
    }
    database.exec("PRAGMA user_version = 2");
    return 2;
  }
  if (version === 2) {
    assertWorkspaceTaskStateSchema(database);
    database.exec(`
      CREATE TABLE session_projection (
        id TEXT PRIMARY KEY NOT NULL,
        identity_key TEXT UNIQUE NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        latest_revision_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE session_projection_revision (
        id TEXT PRIMARY KEY NOT NULL,
        projection_id TEXT NOT NULL REFERENCES session_projection(id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        revision_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(projection_id, ordinal),
        UNIQUE(projection_id, content_hash)
      ) STRICT;
      PRAGMA user_version = 3;
    `);
    return 3;
  }
  if (version === 3) {
    assertWorkspaceTaskStateSchema(database);
    database.exec(`
      CREATE TABLE session_projection_audit (
        id TEXT PRIMARY KEY NOT NULL,
        projection_id TEXT NOT NULL REFERENCES session_projection(id) ON DELETE RESTRICT,
        audit_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 4;
    `);
    return 4;
  }
  if (version === 4) {
    assertWorkspaceTaskStateSchema(database);
    assertSessionProjectionSchema(database);
    database.exec(`
      CREATE TABLE context_handoff_snapshot (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL,
        target_task_id TEXT UNIQUE NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 5;
    `);
    return 5;
  }
  throw new Error(`No Task store migration is available from schema version ${version}`);
}

function initializeTaskStoreSchema(database: DatabaseSync): void {
  const initialVersion = readSchemaVersion(database);
  if (initialVersion > TASK_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Task store schema version ${initialVersion} is newer than supported version ${TASK_STORE_SCHEMA_VERSION}`,
    );
  }

  if (initialVersion === TASK_STORE_SCHEMA_VERSION) {
    assertWorkspaceTaskStateSchema(database);
    assertSessionProjectionSchema(database);
    assertContextHandoffSchema(database);
    return;
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    // Another process may have completed the migration while this connection
    // waited for the write lock, so the authoritative version is read again.
    let version = readSchemaVersion(database);
    if (version > TASK_STORE_SCHEMA_VERSION) {
      throw new Error(
        `Task store schema version ${version} is newer than supported version ${TASK_STORE_SCHEMA_VERSION}`,
      );
    }
    while (version < TASK_STORE_SCHEMA_VERSION) {
      version = migrateFromVersion(database, version);
    }
    assertWorkspaceTaskStateSchema(database);
    assertSessionProjectionSchema(database);
    assertContextHandoffSchema(database);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Task store schema migration failed and SQLite could not roll it back",
      );
    }
    throw error;
  }
}

function emptyWorkspaceState(workspaceId: string, now: string): WorkspaceTaskState {
  return {
    version: 2,
    workspaceId,
    tasks: [],
    updatedAt: now,
  };
}

function newest<T>(left: T, right: T, timestamp: (value: T) => string): T {
  return timestamp(right).localeCompare(timestamp(left)) >= 0 ? right : left;
}

function mergeMessages(
  current: PersistedTaskMessage[],
  incoming: PersistedTaskMessage[],
): PersistedTaskMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "")
      || left.id.localeCompare(right.id));
}

function eventIdentity(event: PersistedRunEvent): string {
  return JSON.stringify([event.type, event.occurredAt, event.payload]);
}

function mergeRunEvents(
  runId: string,
  current: PersistedRunEvent[],
  incoming: PersistedRunEvent[],
): PersistedRunEvent[] {
  const byIdentity = new Map<string, PersistedRunEvent>();
  for (const event of [...current, ...incoming]) byIdentity.set(eventIdentity(event), event);
  return [...byIdentity.values()]
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
        || left.sequence - right.sequence
        || left.type.localeCompare(right.type))
    .map((event, index) => ({ ...event, id: `${runId}:${index + 1}`, sequence: index + 1 }));
}

function mergeRun(current: PersistedRun, incoming: PersistedRun): PersistedRun {
  const base = newest(current, incoming, (run) => run.updatedAt);
  const gitPatch = base.gitPatch ?? current.gitPatch ?? incoming.gitPatch;
  const preferredBaseline = base.gitBaseline ?? current.gitBaseline ?? incoming.gitBaseline;
  const gitBaseline = gitPatch
    ? [base.gitBaseline, current.gitBaseline, incoming.gitBaseline]
      .find((baseline) => baseline?.id === gitPatch.baselineId)
    : preferredBaseline;
  const verifications = new Map((current.verifications ?? []).map((item) => [item.id, item]));
  for (const verification of incoming.verifications ?? []) {
    const existing = verifications.get(verification.id);
    verifications.set(verification.id, existing
      ? newest(existing, verification, (item: VerificationEvidence) => item.finishedAt)
      : verification);
  }
  const permissionDecisions = new Map((current.permissionDecisions ?? []).map((item) => [item.id, item]));
  for (const decision of incoming.permissionDecisions ?? []) permissionDecisions.set(decision.id, decision);
  const decisions = [...permissionDecisions.values()].sort((left, right) =>
    left.decidedAt.localeCompare(right.decidedAt) || left.id.localeCompare(right.id));
  const decisionByRequest = new Map(decisions.map((decision) => [decision.requestId, decision]));
  const permissionRequests = new Map((current.permissionRequests ?? []).map((item) => [item.id, item]));
  for (const request of incoming.permissionRequests ?? []) {
    const existing = permissionRequests.get(request.id);
    permissionRequests.set(request.id, existing && existing.status !== "pending" && request.status === "pending"
      ? existing
      : request);
  }
  const requests = [...permissionRequests.values()]
    .map((request) => {
      const decision = decisionByRequest.get(request.id);
      return decision ? { ...request, status: decision.decision } : request;
    })
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id));
  const gitRestores = new Map((current.gitRestores ?? []).map((item) => [item.id, item]));
  for (const restore of incoming.gitRestores ?? []) gitRestores.set(restore.id, restore);
  return {
    ...base,
    ...(base.agentSnapshot ?? current.agentSnapshot ?? incoming.agentSnapshot
      ? { agentSnapshot: base.agentSnapshot ?? current.agentSnapshot ?? incoming.agentSnapshot }
      : {}),
    ...(base.contextSnapshot ?? current.contextSnapshot ?? incoming.contextSnapshot
      ? { contextSnapshot: base.contextSnapshot ?? current.contextSnapshot ?? incoming.contextSnapshot }
      : {}),
    ...(gitBaseline ? { gitBaseline } : {}),
    ...(gitPatch ? { gitPatch } : {}),
    contextFiles: base.contextFiles ?? current.contextFiles ?? incoming.contextFiles ?? [],
    gitRestores: [...gitRestores.values()].sort((left, right) =>
      left.restoredAt.localeCompare(right.restoredAt) || left.id.localeCompare(right.id)),
    permissionRequests: requests,
    permissionDecisions: decisions,
    verifications: [...verifications.values()].sort((left, right) =>
      left.finishedAt.localeCompare(right.finishedAt) || left.id.localeCompare(right.id)),
    events: mergeRunEvents(base.id, current.events, incoming.events),
  };
}

function mergeRuns(current: PersistedRun[], incoming: PersistedRun[]): PersistedRun[] {
  const byId = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) {
    const existing = byId.get(run.id);
    byId.set(run.id, existing ? mergeRun(existing, run) : run);
  }
  return [...byId.values()].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

function mergeTask(current: PersistedTask, incoming: PersistedTask): PersistedTask {
  const taskTimestamp = (task: PersistedTask) => task.updatedAtIso ?? task.createdAt ?? "";
  const base = newest(current, incoming, taskTimestamp);
  const acceptances = new Map((current.reviewAcceptances ?? []).map((item) => [item.id, item]));
  for (const acceptance of incoming.reviewAcceptances ?? []) {
    acceptances.set(acceptance.id, acceptance);
  }
  const handoffTargets = new Map((current.handoffTargets ?? []).map((item) => [item.snapshotId, item]));
  for (const relation of incoming.handoffTargets ?? []) handoffTargets.set(relation.snapshotId, relation);
  return {
    ...base,
    messages: mergeMessages(current.messages, incoming.messages),
    runs: mergeRuns(current.runs, incoming.runs),
    reviewAcceptances: [...acceptances.values()].sort((left, right) =>
      left.acceptedAt.localeCompare(right.acceptedAt) || left.id.localeCompare(right.id)),
    handoffTargets: [...handoffTargets.values()],
  };
}

/**
 * Merges independently edited full snapshots without dropping Task history.
 *
 * Task scalar fields use the newest task timestamp. Append-only identity-bearing
 * collections are unioned, and matching Runs merge their ordered event history.
 * Explicit task deletion is intentionally unsupported until the protocol has
 * tombstones; otherwise a stale client could silently resurrect deleted data.
 */
export function mergeWorkspaceTaskStates(
  current: WorkspaceTaskState,
  incoming: WorkspaceTaskState,
): WorkspaceTaskState {
  if (current.workspaceId !== incoming.workspaceId) {
    throw new Error("Cannot merge task state from different workspaces");
  }
  const byId = new Map(current.tasks.map((task) => [task.id, task]));
  for (const task of incoming.tasks) {
    const existing = byId.get(task.id);
    byId.set(task.id, existing ? mergeTask(existing, task) : task);
  }
  return workspaceTaskStateSchema.parse({
    version: 2,
    workspaceId: current.workspaceId,
    tasks: [...byId.values()].sort((left, right) =>
      (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || left.id.localeCompare(right.id)),
    updatedAt: current.updatedAt.localeCompare(incoming.updatedAt) >= 0
      ? current.updatedAt
      : incoming.updatedAt,
  });
}

function interruptRun(run: PersistedRun, now: string): PersistedRun {
  if (run.status === "running") {
    return {
      ...run,
      status: "interrupted",
      updatedAt: now,
      finishedAt: now,
      error: run.error || "Rux 上次退出后，Agent 进程已不存在",
    };
  }
  if (run.status !== "waiting-permission") return run;

  const pendingProviderRequests = run.permissionRequests.filter((request) =>
    request.status === "pending" && request.scope.appliesTo === "single-action");
  if (!pendingProviderRequests.length) return run;

  const existingDecisionRequests = new Set(run.permissionDecisions.map((decision) => decision.requestId));
  const decisions = pendingProviderRequests
    .filter((request) => !existingDecisionRequests.has(request.id))
    .map((request) => ({
      id: `permission-decision-interrupted-${createHash("sha256").update(request.id).digest("hex").slice(0, 24)}`,
      requestId: request.id,
      runId: run.id,
      decision: "cancelled" as const,
      source: "runtime" as const,
      decidedAt: now,
    }));
  const permissionEvents: PersistedRunEvent[] = decisions.map((decision, index) => ({
    id: `${run.id}:${run.events.length + index + 1}`,
    sequence: run.events.length + index + 1,
    type: "permission.decided",
    occurredAt: now,
    payload: { type: "permission.decided", runId: run.id, decision },
  }));
  return {
    ...run,
    status: "interrupted",
    updatedAt: now,
    finishedAt: now,
    error: run.error || "Rux 上次退出后，provider-native 权限请求已失效，Agent 进程已不存在",
    permissionRequests: run.permissionRequests.map((request) =>
      request.status === "pending" && request.scope.appliesTo === "single-action"
        ? { ...request, status: "cancelled" as const }
        : request),
    permissionDecisions: [...run.permissionDecisions, ...decisions],
    events: [...run.events, ...permissionEvents],
  };
}

function interruptTask(task: PersistedTask, now: string): PersistedTask {
  const runs = task.runs.map((run) => interruptRun(run, now));
  const runWasInterrupted = runs.some((run, index) =>
    run !== task.runs[index] && run.status === "interrupted");
  const shouldStop = task.status === "running" || (task.status === "blocked" && runWasInterrupted);
  if (!shouldStop) {
    return runs.some((run, index) => run !== task.runs[index]) ? { ...task, runs } : task;
  }

  return {
    ...task,
    status: "interrupted",
    preview: "上次运行因 Rux 退出而中断",
    updatedAt: "刚刚",
    updatedAtIso: now,
    activity: task.activity.map((activity) => activity.state === "active"
      ? { ...activity, state: "error" as const }
      : activity),
    runs,
  };
}

export function normalizeInterruptedTaskState(
  state: WorkspaceTaskState,
  now = new Date().toISOString(),
): { state: WorkspaceTaskState; changed: boolean } {
  const tasks = state.tasks.map((task) => interruptTask(task, now));
  const changed = tasks.some((task, index) => task !== state.tasks[index]);
  return {
    state: changed ? { ...state, tasks, updatedAt: now } : state,
    changed,
  };
}

export type AgentRevisionResolver = (revisionId: string) => AgentRevision | undefined;

function legacyRevisionIds(state: WorkspaceTaskState): Set<string> {
  const ids = new Set<string>();
  for (const task of state.tasks) {
    if (task.agentRevisionSnapshot?.origin === "legacy-task") ids.add(task.agentRevisionId);
    for (const run of task.runs) {
      if (run.agentSnapshot?.origin === "legacy-task") ids.add(run.agentRevisionId);
    }
  }
  return ids;
}

function assertRevisionReference(
  label: string,
  revisionId: string,
  adapter: PersistedRun["adapter"],
  connectionId: string,
  snapshot: AgentRevision | undefined,
  profileId: string | undefined,
  resolver: AgentRevisionResolver | undefined,
  knownLegacyIds: Set<string>,
): void {
  const builtInAdapter = builtInAgentRevisionAdapter(revisionId);
  if (builtInAdapter) {
    if (builtInAdapter !== adapter) throw new Error(`${label} built-in Agent Revision uses the wrong Engine`);
    const expected = defaultProviderConnectionForAdapter(adapter);
    if (connectionId !== expected.id) throw new Error(`${label} built-in Agent Revision uses the wrong Connection`);
    if (snapshot) throw new Error(`${label} built-in Agent Revision must not carry a custom snapshot`);
    if (profileId) throw new Error(`${label} built-in Agent Revision must not reference a custom Agent profile`);
    return;
  }

  if (revisionId.startsWith("legacy-agent-revision:")) {
    if (!knownLegacyIds.has(revisionId) || snapshot?.origin !== "legacy-task" || snapshot.id !== revisionId) {
      throw new Error(`${label} references an unknown legacy Agent Revision`);
    }
    if (snapshot.backend !== adapter || snapshot.providerConnection.id !== connectionId) {
      throw new Error(`${label} legacy Agent Revision uses the wrong Engine or Connection`);
    }
    return;
  }

  if (!resolver) throw new Error(`${label} custom Agent Revision cannot be resolved by this Task store`);
  const resolved = resolver(revisionId);
  if (!resolved) throw new Error(`${label} references a nonexistent Agent Revision: ${revisionId}`);
  if (resolved.backend !== adapter || resolved.providerConnection.id !== connectionId) {
    throw new Error(`${label} Agent Revision uses the wrong Engine or Connection`);
  }
  if (!profileId || resolved.profileId !== profileId) {
    throw new Error(`${label} Agent Revision does not belong to its Agent profile`);
  }
  if (snapshot && snapshot.id !== resolved.id) {
    throw new Error(`${label} snapshot does not match its resolved Agent Revision`);
  }
}

function assertAgentRevisionReferences(
  state: WorkspaceTaskState,
  resolver: AgentRevisionResolver | undefined,
  knownLegacyIds: Set<string>,
): void {
  for (const task of state.tasks) {
    assertRevisionReference(
      `Task ${task.id}`,
      task.agentRevisionId,
      task.adapter,
      task.providerConnection.id,
      task.agentRevisionSnapshot,
      task.agentProfileId,
      resolver,
      knownLegacyIds,
    );
    for (const run of task.runs) {
      assertRevisionReference(
        `Run ${run.id}`,
        run.agentRevisionId,
        run.adapter,
        run.providerConnection.id,
        run.agentSnapshot,
        run.profileId,
        resolver,
        knownLegacyIds,
      );
    }
  }
}

function importedPartText(part: SessionContentPart): string {
  switch (part.type) {
    case "text": return part.text;
    case "tool-call": return `[工具调用: ${part.name}]${part.input ? `\n${part.input}` : ""}`;
    case "tool-result": return `[工具结果${part.isError ? " · 失败" : ""}]${part.output ? `\n${part.output}` : ""}`;
    case "unsupported": return `[暂不支持的内容类型: ${part.providerType}]`;
  }
}

export function sessionMessagesForTask(
  messages: SessionMessage[],
  adapter: "codex" | "claude-code",
  agentRevisionId: string,
): PersistedTaskMessage[] {
  const agent = adapter === "codex" ? "Codex" : "Claude Code";
  return messages.map((message, index) => {
    const identity = createHash("sha256").update(`${message.id}:${index}`).digest("hex").slice(0, 32);
    return {
      id: `imported-message-${identity}`,
      role: message.role === "user" ? "user" : "assistant",
      text: message.content.map(importedPartText).filter(Boolean).join("\n\n"),
      time: message.createdAt ? new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "导入",
      ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      ...(message.role !== "user" ? { agent, adapter, agentRevisionId } : {}),
    };
  });
}

function parseStoredState(row: StoredWorkspaceRow | undefined, workspaceId: string, now: string): WorkspaceTaskState {
  if (!row) return emptyWorkspaceState(workspaceId, now);
  try {
    const state = workspaceTaskStateSchema.parse(JSON.parse(row.state_json) as unknown);
    if (state.workspaceId !== workspaceId) throw new Error(`Stored task state workspace mismatch: expected ${workspaceId}`);
    return state;
  } catch (error) {
    throw new Error(`Stored task state for workspace ${workspaceId} is invalid`, { cause: error });
  }
}

export interface ImportExternalSessionInput {
  workspaceId: string;
  workspaceBranch: string;
  preview: SessionPreviewResult;
  mode: SessionImportMode;
}

export interface RefreshExternalSessionInput {
  workspaceId: string;
  taskId: string;
  preview: SessionPreviewResult;
}

export interface HandoffSelectionInput {
  workspaceId: string;
  sourceTaskId: string;
  target: HandoffTarget;
  messageIds: string[];
  filePaths: string[];
  sourceAgentAvailable: boolean;
}

export interface HandoffCommitInput extends HandoffSelectionInput {
  fingerprint: string;
  agentSummary?: string;
  agentSummaryProvenance?: HandoffSummaryProvenance;
  constraints?: string;
}

function handoffFacts(task: PersistedTask, messageIds: string[], filePaths: string[]): ContextHandoffFactBundle {
  const selectedMessages = new Set(messageIds);
  const messages = task.messages.filter((message) => selectedMessages.has(message.id)).map((message) => ({
    id: message.id, role: message.role, text: message.text, ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  }));
  if (messages.length !== selectedMessages.size) throw new Error("Handoff selection references a message outside the source Task");
  const latestRun = task.runs.at(-1);
  const selectedFiles = new Set(filePaths);
  const files = latestRun?.gitPatch?.files.filter((file) => selectedFiles.has(file.path)).map((file) => ({
    path: file.path, status: file.kind, additions: file.additions, deletions: file.deletions,
    runId: latestRun.id, snapshotId: latestRun.gitPatch!.snapshotId,
  })) ?? [];
  if (files.length !== selectedFiles.size) throw new Error("Handoff selection references a file without persisted Run-owned evidence");
  const lastAssistant = latestRun
    ? [...task.messages].reverse().find((message) => message.role === "assistant" && message.runId === latestRun.id)
    : undefined;
  return contextHandoffFactBundleSchema.parse({
    sourceTask: { id: task.id, title: task.title, workspaceId: task.workspaceId, agentRevisionId: task.agentRevisionId },
    messages,
    ...(latestRun ? { latestRun: { id: latestRun.id, status: latestRun.status, prompt: latestRun.prompt, ...(lastAssistant ? { result: lastAssistant.text } : {}), ...(latestRun.finishedAt ? { finishedAt: latestRun.finishedAt } : {}) } } : {}),
    files,
    incomplete: task.plan.filter((step) => step.state !== "done").map((step) => step.label),
  });
}

function handoffFingerprint(target: HandoffTarget, facts: ContextHandoffFactBundle): string {
  return createHash("sha256").update(JSON.stringify({ target, facts })).digest("hex");
}

function handoffPrompt(snapshot: ContextHandoffSnapshot): string {
  const facts = snapshot.facts;
  const lines = [`Context Handoff from “${facts.sourceTask.title}”`, `Source Task: ${facts.sourceTask.id}`, `Source Agent Revision: ${facts.sourceTask.agentRevisionId}`];
  if (snapshot.agentSummary) lines.push("", snapshot.agentSummaryProvenance ? "Agent-generated summary (reviewed by user):" : "User-authored handoff summary:", snapshot.agentSummary);
  if (snapshot.constraints) lines.push("", "Additional constraints:", snapshot.constraints);
  if (facts.messages.length) lines.push("", "Selected messages:", ...facts.messages.map((message) => `- ${message.role}: ${message.text}`));
  if (facts.latestRun) lines.push("", `Latest Run: ${facts.latestRun.status} · ${facts.latestRun.prompt}`, ...(facts.latestRun.result ? [facts.latestRun.result] : []));
  if (facts.files.length) lines.push("", "Run-owned files:", ...facts.files.map((file) => `- ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`));
  if (facts.incomplete.length) lines.push("", "Incomplete items:", ...facts.incomplete.map((item) => `- ${item}`));
  return lines.join("\n").slice(0, 100_000);
}

function messageFingerprint(message: SessionMessage): string {
  return createHash("sha256").update(JSON.stringify({ role: message.role, createdAt: message.createdAt, content: message.content })).digest("hex");
}

function messagePreview(message: SessionMessage): string {
  return message.content.map(importedPartText).join(" ").replace(/\s+/g, " ").trim().slice(0, 1_000) || "（空消息）";
}

function syntheticMessageId(id: string): boolean {
  return /^claude-\d+-[a-f0-9-]{36}$/i.test(id) || /^codex-\d+-\d+$/.test(id);
}

export function compareSessionProjection(
  current: SessionMessage[],
  incoming: SessionMessage[],
): SessionProjectionDiff {
  const exact = (left: SessionMessage, right: SessionMessage) => JSON.stringify(left) === JSON.stringify(right);
  const unchanged = current.length === incoming.length && current.every((message, index) => exact(message, incoming[index]));
  if (unchanged) return sessionProjectionDiffSchema.parse({ status: "unchanged", additions: 0, modifications: 0, deletions: 0, moves: 0, uncertainMatches: 0, changes: [] });

  const stablePrefix = current.every((message, index) => (
    !syntheticMessageId(message.id)
    && incoming[index]?.id === message.id
    && exact(message, incoming[index])
  ));
  if (stablePrefix && incoming.length > current.length) {
    const additions = incoming.slice(current.length);
    return sessionProjectionDiffSchema.parse({
      status: "append-only",
      additions: additions.length,
      modifications: 0,
      deletions: 0,
      moves: 0,
      uncertainMatches: 0,
      changes: additions.slice(0, 200).map((message, offset) => ({ kind: "added", messageId: message.id, nextIndex: current.length + offset, role: message.role, preview: messagePreview(message) })),
    });
  }

  const currentById = new Map(current.map((message, index) => [message.id, { message, index }]));
  const incomingById = new Map(incoming.map((message, index) => [message.id, { message, index }]));
  const changes: Array<{ kind: "added" | "modified" | "deleted" | "moved" | "uncertain"; messageId?: string; previousIndex?: number; nextIndex?: number; role?: SessionMessage["role"]; preview: string }> = [];
  let additions = 0; let modifications = 0; let deletions = 0; let moves = 0; let uncertainMatches = 0;
  for (const [id, prior] of currentById) {
    const next = incomingById.get(id);
    if (!next) {
      deletions += 1;
      changes.push({ kind: "deleted", messageId: id, previousIndex: prior.index, role: prior.message.role, preview: messagePreview(prior.message) });
    } else if (!exact(prior.message, next.message)) {
      modifications += 1;
      changes.push({ kind: "modified", messageId: id, previousIndex: prior.index, nextIndex: next.index, role: next.message.role, preview: messagePreview(next.message) });
    } else if (prior.index !== next.index) {
      moves += 1;
      changes.push({ kind: "moved", messageId: id, previousIndex: prior.index, nextIndex: next.index, role: next.message.role, preview: messagePreview(next.message) });
    }
  }
  for (const [id, next] of incomingById) {
    if (currentById.has(id)) continue;
    additions += 1;
    changes.push({ kind: "added", messageId: id, nextIndex: next.index, role: next.message.role, preview: messagePreview(next.message) });
  }
  const currentFingerprints = new Map(current.map((message, index) => [messageFingerprint(message), index]));
  for (const [index, message] of incoming.entries()) {
    if (currentById.has(message.id)) continue;
    const previousIndex = currentFingerprints.get(messageFingerprint(message));
    if (previousIndex === undefined) continue;
    uncertainMatches += 1;
    changes.push({ kind: "uncertain", messageId: message.id, previousIndex, nextIndex: index, role: message.role, preview: messagePreview(message) });
  }
  return sessionProjectionDiffSchema.parse({ status: "external-differences", additions, modifications, deletions, moves, uncertainMatches, changes: changes.slice(0, 200) });
}

function revisionContentHash(metadata: SessionPreviewResult["metadata"], messages: SessionMessage[]): string {
  return createHash("sha256").update(JSON.stringify({ metadata, messages })).digest("hex");
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function exportedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(exportedValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret|credential)$/i.test(key)) continue;
    result[key] = exportedValue(child);
  }
  return result;
}

function markdownExport(workspaceId: string, tasks: PersistedTask[], revisions: SessionProjectionRevision[]): string {
  const lines = ["# Rux 本地数据导出", "", `Workspace: ${workspaceId}`, "", "> 该文件可能包含提示词、文件内容、命令输出和其他敏感会话内容。", ""];
  for (const task of tasks) {
    lines.push(`## ${task.title}`, "", `- Task ID: ${task.id}`, `- Agent: ${task.agent}`, `- Model: ${task.model}`, `- Created: ${task.createdAt ?? "未知"}`, "");
    for (const message of task.messages) {
      lines.push(`### ${message.role === "user" ? "用户" : "Agent"}`, "", message.text, "");
    }
    const taskRevisions = revisions.filter((revision) => revision.projectionId === task.importedSession?.projectionId);
    if (taskRevisions.length) {
      lines.push("### Projection Revisions", "");
      for (const revision of taskRevisions) lines.push(`- Revision ${revision.ordinal}: ${revision.messages.length} 条消息 · ${revision.createdAt}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Main-process-owned Task/Message/Run store.
 *
 * A workspace snapshot is validated and merged in one SQLite transaction. This
 * preserves independently appended Task/Message/Run/Event/review history when
 * Desktop and TUI save stale snapshots. Renderer code never receives a database
 * handle or filesystem path, and every read/write crosses the shared Zod boundary
 * before it can reach durable storage.
 */
export class TaskStore {
  readonly #database: DatabaseSync;
  readonly #now: () => string;
  readonly #revisionResolver: AgentRevisionResolver | undefined;
  #closed = false;

  constructor(
    databasePath: string,
    now: () => string = () => new Date().toISOString(),
    revisionResolver?: AgentRevisionResolver,
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#now = now;
    this.#revisionResolver = revisionResolver;
    try {
      this.#database.exec("PRAGMA synchronous = FULL");
      this.#database.exec("PRAGMA foreign_keys = ON");
      this.#database.exec("PRAGMA busy_timeout = 5000");
      initializeTaskStoreSchema(this.#database);
      this.#database.exec("PRAGMA journal_mode = WAL");
    } catch (error) {
      this.#closed = true;
      this.#database.close();
      throw error;
    }
  }

  load(workspaceIdInput: string): WorkspaceTaskState {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const row = this.#database
      .prepare("SELECT state_json FROM workspace_task_state WHERE workspace_id = ?")
      .get(workspaceId) as StoredWorkspaceRow | undefined;
    const now = this.#now();
    if (!row) return emptyWorkspaceState(workspaceId, now);

    let stored: unknown;
    try {
      stored = JSON.parse(row.state_json) as unknown;
    } catch (error) {
      throw new Error(`Stored task state for workspace ${workspaceId} is not valid JSON`, { cause: error });
    }

    const state = workspaceTaskStateSchema.parse(stored);
    if (state.workspaceId !== workspaceId) {
      throw new Error(`Stored task state workspace mismatch: expected ${workspaceId}`);
    }
    assertAgentRevisionReferences(state, this.#revisionResolver, legacyRevisionIds(state));

    const normalized = normalizeInterruptedTaskState(state, now);
    if (normalized.changed) this.save(normalized.state);
    return normalized.state;
  }

  save(input: unknown): WorkspaceTaskState {
    const incoming = workspaceTaskStateSchema.parse(input);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const storedRow = this.#database
        .prepare("SELECT state_json FROM workspace_task_state WHERE workspace_id = ?")
        .get(incoming.workspaceId) as StoredWorkspaceRow | undefined;
      let state: WorkspaceTaskState = incoming;
      let knownLegacyIds = new Set<string>();
      if (storedRow) {
        let stored: unknown;
        try {
          stored = JSON.parse(storedRow.state_json) as unknown;
        } catch (error) {
          throw new Error(`Stored task state for workspace ${incoming.workspaceId} is not valid JSON`, { cause: error });
        }
        const current = workspaceTaskStateSchema.parse(stored);
        knownLegacyIds = legacyRevisionIds(current);
        assertAgentRevisionReferences(incoming, this.#revisionResolver, knownLegacyIds);
        state = mergeWorkspaceTaskStates(current, incoming);
      } else {
        assertAgentRevisionReferences(incoming, this.#revisionResolver, knownLegacyIds);
      }
      const serialized = JSON.stringify(state);
      this.#database.prepare(`
        INSERT INTO workspace_task_state (workspace_id, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `).run(state.workspaceId, serialized, state.updatedAt);
      this.#database.exec("COMMIT");
      return state;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getLocalDataSummary(workspaceIdInput: string): LocalDataSummary {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const state = this.load(workspaceId);
    const projectionRows = this.#database.prepare("SELECT state_json FROM session_projection WHERE workspace_id = ?")
      .all(workspaceId) as unknown as Array<{ state_json: string }>;
    const revisionRows = this.#database.prepare("SELECT revision_json FROM session_projection_revision WHERE projection_id IN (SELECT id FROM session_projection WHERE workspace_id = ?)")
      .all(workspaceId) as unknown as StoredRevisionExportRow[];
    const auditRows = this.#database.prepare("SELECT audit_json FROM session_projection_audit WHERE projection_id IN (SELECT id FROM session_projection WHERE workspace_id = ?)")
      .all(workspaceId) as unknown as StoredAuditRow[];
    const handoffRows = this.#database.prepare("SELECT snapshot_json FROM context_handoff_snapshot WHERE workspace_id = ?")
      .all(workspaceId) as unknown as StoredHandoffExportRow[];
    const estimatedBytes = serializedBytes(state)
      + projectionRows.reduce((sum, row) => sum + serializedBytes(row.state_json), 0)
      + revisionRows.reduce((sum, row) => sum + serializedBytes(row.revision_json), 0)
      + auditRows.reduce((sum, row) => sum + serializedBytes(row.audit_json), 0)
      + handoffRows.reduce((sum, row) => sum + serializedBytes(row.snapshot_json), 0);
    return localDataSummarySchema.parse({
      workspaceId,
      estimatedBytes,
      taskCount: state.tasks.length,
      importedTaskCount: state.tasks.filter((task) => task.importedSession).length,
      projectionRevisionCount: revisionRows.length,
      handoffCount: handoffRows.length,
    });
  }

  previewLocalDataAction(workspaceIdInput: string, input: LocalDataPreviewParams): LocalDataImpactPreview {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const params = localDataPreviewParamsSchema.parse(input);
    const state = this.load(workspaceId);
    const selected = params.scope === "workspace"
      ? state.tasks
      : state.tasks.filter((task) => task.id === params.taskId);
    if (params.scope === "task" && !selected.length) throw new Error("Task was not found in the active Workspace");
    const affected = params.action === "delete-task" ? selected : selected.filter((task) => task.importedSession);
    const projectionIds = affected.flatMap((task) => task.importedSession ? [task.importedSession.projectionId] : []);
    const revisionRows = projectionIds.flatMap((projectionId) => this.#database.prepare("SELECT revision_json FROM session_projection_revision WHERE projection_id = ?")
      .all(projectionId) as unknown as StoredRevisionExportRow[]);
    const revisions = revisionRows.map((row) => sessionProjectionRevisionSchema.parse(JSON.parse(row.revision_json) as unknown));
    const importedIds = new Set<string>();
    for (const task of affected) {
      if (task.adapter !== "codex" && task.adapter !== "claude-code") continue;
      for (const revision of revisions.filter((item) => item.projectionId === task.importedSession?.projectionId)) {
        for (const message of sessionMessagesForTask(revision.messages, task.adapter, task.agentRevisionId)) importedIds.add(message.id);
      }
    }
    const selectedIds = new Set(affected.map((task) => task.id));
    const handoffRows = this.#database.prepare("SELECT snapshot_json FROM context_handoff_snapshot WHERE workspace_id = ?")
      .all(workspaceId) as unknown as StoredHandoffExportRow[];
    const affectedHandoffs = handoffRows.filter((row) => {
      const snapshot = contextHandoffSnapshotSchema.parse(JSON.parse(row.snapshot_json) as unknown);
      return selectedIds.has(snapshot.sourceTaskId) || selectedIds.has(snapshot.targetTaskId);
    });
    const projectionBytes = params.action === "unlink" ? 0 : projectionIds.reduce((sum, projectionId) => {
      const projection = this.#database.prepare("SELECT state_json FROM session_projection WHERE id = ?").get(projectionId) as { state_json: string } | undefined;
      const audits = this.#database.prepare("SELECT audit_json FROM session_projection_audit WHERE projection_id = ?").all(projectionId) as unknown as StoredAuditRow[];
      return sum + (projection ? serializedBytes(projection.state_json) : 0)
        + revisionRows.filter((row) => sessionProjectionRevisionSchema.parse(JSON.parse(row.revision_json) as unknown).projectionId === projectionId).reduce((value, row) => value + serializedBytes(row.revision_json), 0)
        + audits.reduce((value, row) => value + serializedBytes(row.audit_json), 0);
    }, 0);
    const taskBytes = params.action === "delete-task"
      ? affected.reduce((sum, task) => sum + serializedBytes(task), 0)
      : params.action === "remove-imported"
        ? affected.reduce((sum, task) => sum + task.messages.filter((message) => importedIds.has(message.id)).reduce((value, message) => value + serializedBytes(message), 0), 0)
        : 0;
    const summary = this.getLocalDataSummary(workspaceId);
    const nativeSessions = affected.flatMap((task) => task.importedSession ? [{ engine: task.importedSession.sessionLink.engine, nativeSessionId: task.importedSession.sessionLink.nativeSessionId }] : []);
    const previewBody = {
      ...summary,
      scope: params.scope,
      action: params.action,
      affectedTaskCount: affected.length,
      affectedProjectionRevisionCount: revisions.length,
      importedMessageCount: affected.reduce((sum, task) => sum + task.messages.filter((message) => importedIds.has(message.id)).length, 0),
      runCount: affected.reduce((sum, task) => sum + task.runs.length, 0),
      affectedHandoffCount: affectedHandoffs.length,
      estimatedReclaimableBytes: projectionBytes + taskBytes + (params.action === "delete-task" ? affectedHandoffs.reduce((sum, row) => sum + serializedBytes(row.snapshot_json), 0) : 0),
      nativeSessions,
    };
    return localDataImpactPreviewSchema.parse({
      ...previewBody,
      fingerprint: createHash("sha256").update(JSON.stringify(previewBody)).digest("hex"),
    });
  }

  executeLocalDataAction(workspaceIdInput: string, input: LocalDataPreviewParams & { fingerprint: string; confirmed?: true }): LocalDataExecuteResult {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const { fingerprint, confirmed: _confirmed, ...previewInput } = input;
    const preview = this.previewLocalDataAction(workspaceId, previewInput);
    if (preview.fingerprint !== fingerprint) throw new Error("Local data changed; review the impact again");
    const now = this.#now();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database.prepare("SELECT state_json FROM workspace_task_state WHERE workspace_id = ?").get(workspaceId) as StoredWorkspaceRow | undefined;
      const state = parseStoredState(row, workspaceId, now);
      const selectedIds = new Set((input.scope === "workspace" ? state.tasks : state.tasks.filter((task) => task.id === input.taskId)).map((task) => task.id));
      const selected = state.tasks.filter((task) => selectedIds.has(task.id));
      const projectionIds = selected.flatMap((task) => task.importedSession ? [task.importedSession.projectionId] : []);
      let tasks = state.tasks;
      if (input.action === "unlink") {
        tasks = state.tasks.map((task) => selectedIds.has(task.id) && task.importedSession
          ? workspaceTaskStateSchema.shape.tasks.element.parse({ ...task, importedSession: { ...task.importedSession, status: "unlinked" }, preview: "已解除原生会话关联；本地内容仍保留", status: "completed", updatedAt: "现在", updatedAtIso: now })
          : task);
      } else if (input.action === "remove-imported") {
        tasks = state.tasks.map((task) => {
          if (!selectedIds.has(task.id) || !task.importedSession || (task.adapter !== "codex" && task.adapter !== "claude-code")) return task;
          const rows = this.#database.prepare("SELECT revision_json FROM session_projection_revision WHERE projection_id = ?").all(task.importedSession.projectionId) as unknown as StoredRevisionExportRow[];
          const importedIds = new Set(rows.flatMap((revisionRow) => sessionMessagesForTask(sessionProjectionRevisionSchema.parse(JSON.parse(revisionRow.revision_json) as unknown).messages, task.adapter as "codex" | "claude-code", task.agentRevisionId).map((message) => message.id)));
          const { importedSession: _binding, ...withoutBinding } = task;
          return workspaceTaskStateSchema.shape.tasks.element.parse({ ...withoutBinding, messages: task.messages.filter((message) => !importedIds.has(message.id)), preview: "已删除导入内容；Rux 自有记录仍保留", status: "completed", updatedAt: "现在", updatedAtIso: now });
        });
      } else {
        tasks = state.tasks.filter((task) => !selectedIds.has(task.id)).map((task) => workspaceTaskStateSchema.shape.tasks.element.parse({
          ...task,
          ...(task.handoffSource && selectedIds.has(task.handoffSource.taskId) ? { handoffSource: undefined } : {}),
          handoffTargets: (task.handoffTargets ?? []).filter((relation) => !selectedIds.has(relation.taskId)),
        }));
      }
      if (input.action !== "unlink") {
        for (const projectionId of projectionIds) {
          this.#database.prepare("DELETE FROM session_projection_audit WHERE projection_id = ?").run(projectionId);
          this.#database.prepare("DELETE FROM session_projection_revision WHERE projection_id = ?").run(projectionId);
          this.#database.prepare("DELETE FROM session_projection WHERE id = ?").run(projectionId);
        }
      }
      if (input.action === "delete-task") {
        this.#database.prepare("DELETE FROM context_handoff_snapshot WHERE workspace_id = ? AND (source_task_id IN (SELECT value FROM json_each(?)) OR target_task_id IN (SELECT value FROM json_each(?)))")
          .run(workspaceId, JSON.stringify([...selectedIds]), JSON.stringify([...selectedIds]));
      }
      const nextState = workspaceTaskStateSchema.parse({ ...state, tasks, updatedAt: now });
      this.#database.prepare("UPDATE workspace_task_state SET state_json = ?, updated_at = ? WHERE workspace_id = ?").run(JSON.stringify(nextState), now, workspaceId);
      this.#database.exec("COMMIT");
      return localDataExecuteResultSchema.parse({ workspaceId, action: input.action, affectedTaskCount: preview.affectedTaskCount, savedAt: now });
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  buildLocalDataExport(workspaceIdInput: string, scope: LocalDataScope, taskId: string | undefined, format: LocalDataExportFormat, revisionScope: LocalDataRevisionScope): LocalDataExportArtifact {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const state = this.load(workspaceId);
    const tasks = scope === "workspace" ? state.tasks : state.tasks.filter((task) => task.id === taskId);
    if (scope === "task" && !tasks.length) throw new Error("Task was not found in the active Workspace");
    const projectionIds = tasks.flatMap((task) => task.importedSession ? [task.importedSession.projectionId] : []);
    const revisions = projectionIds.flatMap((projectionId) => {
      const rows = revisionScope === "all"
        ? this.#database.prepare("SELECT revision_json FROM session_projection_revision WHERE projection_id = ? ORDER BY ordinal").all(projectionId) as unknown as StoredRevisionExportRow[]
        : this.#database.prepare("SELECT revision_json FROM session_projection_revision WHERE projection_id = ? AND id = (SELECT latest_revision_id FROM session_projection WHERE id = ?)").all(projectionId, projectionId) as unknown as StoredRevisionExportRow[];
      return rows.map((row) => sessionProjectionRevisionSchema.parse(JSON.parse(row.revision_json) as unknown));
    });
    const handoffs = (this.#database.prepare("SELECT snapshot_json FROM context_handoff_snapshot WHERE workspace_id = ?").all(workspaceId) as unknown as StoredHandoffExportRow[])
      .map((row) => contextHandoffSnapshotSchema.parse(JSON.parse(row.snapshot_json) as unknown))
      .filter((snapshot) => tasks.some((task) => task.id === snapshot.sourceTaskId || task.id === snapshot.targetTaskId));
    const stamp = this.#now().slice(0, 10);
    const baseName = `rux-${scope === "workspace" ? "workspace" : "task"}-${stamp}`;
    if (format === "markdown") return { suggestedName: `${baseName}.md`, mimeType: "text/markdown", content: markdownExport(workspaceId, tasks, revisions) };
    const content = `${JSON.stringify(exportedValue({ schemaVersion: 1, exportedAt: this.#now(), workspaceId, revisionScope, tasks, projectionRevisions: revisions, handoffs }), null, 2)}\n`;
    return { suggestedName: `${baseName}.json`, mimeType: "application/json", content };
  }

  previewContextHandoff(input: HandoffSelectionInput): HandoffPreviewResult {
    const workspaceId = persistedWorkspaceIdSchema.parse(input.workspaceId);
    const target = handoffTargetSchema.parse(input.target);
    const state = this.load(workspaceId);
    const source = state.tasks.find((task) => task.id === input.sourceTaskId);
    if (!source) throw new Error("Handoff source Task was not found");
    if (target.providerConnection.engine !== target.adapter) throw new Error("Handoff target Connection uses the wrong Engine");
    assertRevisionReference("Handoff target", target.agentRevisionId, target.adapter, target.providerConnection.id, undefined, target.agentProfileId, this.#revisionResolver, legacyRevisionIds(state));
    const facts = handoffFacts(source, input.messageIds, input.filePaths);
    return handoffPreviewResultSchema.parse({ target, facts, sourceAgentAvailable: input.sourceAgentAvailable, fingerprint: handoffFingerprint(target, facts) });
  }

  commitContextHandoff(input: HandoffCommitInput): HandoffCommitResult {
    const preview = this.previewContextHandoff(input);
    if (preview.fingerprint !== input.fingerprint) throw new Error("Handoff source facts changed; review the preview again");
    const workspaceId = persistedWorkspaceIdSchema.parse(input.workspaceId);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database.prepare("SELECT state_json FROM workspace_task_state WHERE workspace_id = ?").get(workspaceId) as StoredWorkspaceRow | undefined;
      const now = this.#now();
      const state = parseStoredState(row, workspaceId, now);
      const sourceIndex = state.tasks.findIndex((task) => task.id === input.sourceTaskId);
      if (sourceIndex < 0) throw new Error("Handoff source Task was not found");
      const currentFacts = handoffFacts(state.tasks[sourceIndex], input.messageIds, input.filePaths);
      if (handoffFingerprint(preview.target, currentFacts) !== input.fingerprint) throw new Error("Handoff source facts changed; review the preview again");
      const snapshotId = `context-handoff-${randomUUID()}`;
      const targetTaskId = `handoff-task-${randomUUID()}`;
      const snapshot = contextHandoffSnapshotSchema.parse({
        id: snapshotId, sourceTaskId: input.sourceTaskId, targetTaskId, workspaceId,
        target: preview.target, facts: currentFacts,
        ...(input.agentSummary?.trim() ? { agentSummary: input.agentSummary.trim() } : {}),
        ...(input.agentSummary?.trim() && input.agentSummaryProvenance ? { agentSummaryProvenance: input.agentSummaryProvenance } : {}),
        ...(input.constraints?.trim() ? { constraints: input.constraints.trim() } : {}),
        createdAt: now,
      });
      const targetTask = workspaceTaskStateSchema.shape.tasks.element.parse({
        id: targetTaskId, workspaceId,
        title: `继续：${state.tasks[sourceIndex].title}`.slice(0, 10_000),
        preview: `来自 ${state.tasks[sourceIndex].title} 的 Context Handoff`,
        status: "waiting", updatedAt: "现在", updatedAtIso: now, createdAt: now,
        agent: preview.target.agentName, adapter: preview.target.adapter,
        ...(preview.target.agentProfileId ? { agentProfileId: preview.target.agentProfileId } : {}),
        agentRevisionId: preview.target.agentRevisionId,
        providerConnection: preview.target.providerConnection,
        permissionMode: preview.target.permissionMode,
        model: preview.target.model,
        modelSource: preview.target.modelSource,
        modelVerificationStatus: preview.target.modelVerificationStatus,
        ...(preview.target.reasoningEffort ? { reasoningEffort: preview.target.reasoningEffort } : {}),
        contextFiles: [], branch: state.tasks[sourceIndex].branch, elapsed: "—", tokens: "—",
        messages: [{ id: `handoff-message-${snapshotId}`, role: "user", text: handoffPrompt(snapshot), time: "现在", createdAt: now }],
        plan: [], activity: [], runs: [], reviewAcceptances: [],
        handoffSource: { snapshotId, taskId: input.sourceTaskId }, handoffTargets: [],
      });
      const sourceTask = workspaceTaskStateSchema.shape.tasks.element.parse({
        ...state.tasks[sourceIndex], updatedAtIso: now,
        handoffTargets: [...(state.tasks[sourceIndex].handoffTargets ?? []), { snapshotId, taskId: targetTaskId }],
      });
      const nextState = workspaceTaskStateSchema.parse({ ...state, tasks: [targetTask, ...state.tasks.map((task, index) => index === sourceIndex ? sourceTask : task)], updatedAt: now });
      this.#database.prepare("INSERT INTO context_handoff_snapshot (id, workspace_id, source_task_id, target_task_id, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(snapshot.id, workspaceId, snapshot.sourceTaskId, snapshot.targetTaskId, JSON.stringify(snapshot), now);
      this.#database.prepare(`INSERT INTO workspace_task_state (workspace_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
        .run(workspaceId, JSON.stringify(nextState), now);
      this.#database.exec("COMMIT");
      return handoffCommitResultSchema.parse({ sourceTask, targetTask, snapshot });
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getContextHandoff(snapshotId: string): ContextHandoffSnapshot | undefined {
    const row = this.#database.prepare("SELECT snapshot_json FROM context_handoff_snapshot WHERE id = ?").get(snapshotId) as { snapshot_json: string } | undefined;
    return row ? contextHandoffSnapshotSchema.parse(JSON.parse(row.snapshot_json) as unknown) : undefined;
  }

  importExternalSession(input: ImportExternalSessionInput): SessionImportResult {
    const workspaceId = persistedWorkspaceIdSchema.parse(input.workspaceId);
    const preview = input.preview;
    if (input.mode === "continue" && preview.resume.status !== "available") {
      throw Object.assign(new Error(preview.resume.reason || "该原生会话当前不可继续"), {
        code: "SESSION_RESUME_UNAVAILABLE",
      });
    }
    const now = this.#now();
    const identityKey = preview.identityKey;
    const projectionId = `session-projection-${identityKey}`;
    const defaultTaskId = `imported-session-${identityKey.slice(0, 40)}`;
    const contentHash = createHash("sha256")
      .update(JSON.stringify({ metadata: preview.metadata, messages: preview.messages }))
      .digest("hex");
    const adapter = preview.metadata.engine;
    const providerConnection = defaultProviderConnectionForAdapter(adapter);
    if (providerConnection.id !== preview.metadata.providerConnectionId) {
      throw Object.assign(new Error("会话 Connection 与当前官方 CLI Connection 不一致"), {
        code: "SESSION_CONNECTION_MISMATCH",
      });
    }
    const agentRevisionId = builtInAgentRevisionId(adapter);
    const status = input.mode === "continue"
      ? "linked" as const
      : preview.resume.status === "available" ? "read-only" as const : "native-unavailable" as const;
    const sessionLink = {
      kind: adapter === "codex" ? "codex-thread" as const : "claude-session" as const,
      engine: adapter,
      providerConnectionId: providerConnection.id,
      agentRevisionId,
      workspaceId,
      nativeSessionId: preview.metadata.nativeSessionId,
    };

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const storedProjection = this.#database.prepare(`
        SELECT id, task_id, latest_revision_id, state_json, created_at
        FROM session_projection WHERE identity_key = ?
      `).get(identityKey) as StoredProjectionRow | undefined;
      if (storedProjection && storedProjection.id !== projectionId) {
        throw new Error("Stored Session Projection identity is inconsistent");
      }
      const taskId = storedProjection?.task_id ?? defaultTaskId;
      const existingRevision = this.#database.prepare(`
        SELECT id, revision_json FROM session_projection_revision
        WHERE projection_id = ? AND content_hash = ?
      `).get(projectionId, contentHash) as StoredProjectionRevisionRow | undefined;
      const ordinalRow = this.#database.prepare(`
        SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM session_projection_revision WHERE projection_id = ?
      `).get(projectionId) as { ordinal: number };
      const ordinal = existingRevision ? 0 : Number(ordinalRow.ordinal) + 1;
      const revisionId = existingRevision?.id ?? `session-projection-revision-${identityKey}-${ordinal}`;
      const revision = existingRevision
        ? sessionProjectionRevisionSchema.parse(JSON.parse(existingRevision.revision_json) as unknown)
        : sessionProjectionRevisionSchema.parse({
          id: revisionId,
          projectionId,
          ordinal,
          ...(preview.metadata.updatedAt ? { sourceUpdatedAt: preview.metadata.updatedAt } : {}),
          messageIds: preview.messages.map((message) => message.id),
          metadata: preview.metadata,
          messages: preview.messages,
          contentHash,
          createdAt: now,
        });
      const projection = sessionProjectionSchema.parse({
        id: projectionId,
        source: {
          engine: adapter,
          providerConnectionId: providerConnection.id,
          nativeSessionId: preview.metadata.nativeSessionId,
        },
        taskId,
        workspaceId,
        mode: input.mode,
        status,
        latestRevisionId: revision.id,
        createdAt: storedProjection?.created_at ?? now,
        updatedAt: now,
      });
      const binding = importedSessionBindingSchema.parse({
        identityKey,
        source: adapter === "codex" ? "codex-import" : "claude-code-import",
        mode: input.mode,
        status,
        projectionId,
        currentRevisionId: revision.id,
        sessionLink,
        importedAt: storedProjection?.created_at ?? now,
        lastReadAt: now,
      });

      const storedStateRow = this.#database.prepare(
        "SELECT state_json FROM workspace_task_state WHERE workspace_id = ?",
      ).get(workspaceId) as StoredWorkspaceRow | undefined;
      const state = parseStoredState(storedStateRow, workspaceId, now);
      const existingTask = state.tasks.find((task) => task.id === taskId);
      const importedMessages = sessionMessagesForTask(preview.messages, adapter, agentRevisionId);
      const baseTask: PersistedTask = {
        id: taskId,
        workspaceId,
        title: preview.metadata.title?.trim() || `${adapter === "codex" ? "Codex" : "Claude Code"} 导入会话`,
        preview: input.mode === "continue" ? "已关联原生会话，可继续运行" : "已导入本地投影，仅查看",
        status: input.mode === "continue" ? "waiting" : "completed",
        updatedAt: "现在",
        updatedAtIso: now,
        createdAt: storedProjection?.created_at ?? preview.metadata.createdAt ?? now,
        agent: adapter === "codex" ? "Codex" : "Claude Code",
        adapter,
        agentRevisionId,
        providerConnection,
        permissionMode: "acceptEdits",
        model: preview.metadata.model || `${adapter === "codex" ? "Codex" : "Claude Code"} default`,
        ...defaultModelState(preview.metadata.model),
        branch: input.workspaceBranch,
        elapsed: "—",
        tokens: "—",
        messages: importedMessages,
        plan: [],
        activity: [],
        runs: [],
        reviewAcceptances: [],
        importedSession: binding,
      };
      const task = existingTask
        ? {
          ...existingTask,
          title: baseTask.title,
          preview: baseTask.preview,
          status: baseTask.status,
          updatedAt: baseTask.updatedAt,
          updatedAtIso: now,
          importedSession: binding,
          messages: (() => {
            const existingIds = new Set(existingTask.messages.map((message) => message.id));
            return [...existingTask.messages, ...importedMessages.filter((message) => !existingIds.has(message.id))];
          })(),
        }
        : baseTask;
      const nextState = workspaceTaskStateSchema.parse({
        ...state,
        tasks: [...state.tasks.filter((candidate) => candidate.id !== taskId), task],
        updatedAt: now,
      });
      assertAgentRevisionReferences(nextState, this.#revisionResolver, legacyRevisionIds(state));

      this.#database.prepare(`
        INSERT INTO session_projection
          (id, identity_key, workspace_id, task_id, latest_revision_id, state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(identity_key) DO UPDATE SET
          latest_revision_id = excluded.latest_revision_id,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `).run(
        projection.id, identityKey, workspaceId, taskId, revision.id,
        JSON.stringify(projection), projection.createdAt, projection.updatedAt,
      );
      if (!existingRevision) {
        this.#database.prepare(`
          INSERT INTO session_projection_revision
            (id, projection_id, ordinal, content_hash, revision_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(revision.id, projectionId, revision.ordinal, contentHash, JSON.stringify(revision), revision.createdAt);
      }
      this.#database.prepare(`
        INSERT INTO workspace_task_state (workspace_id, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
      `).run(workspaceId, JSON.stringify(nextState), now);
      this.#database.exec("COMMIT");
      return sessionImportResultSchema.parse({ task, binding, projection, revision, created: !storedProjection });
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  refreshExternalSession(input: RefreshExternalSessionInput): SessionRefreshResult {
    const workspaceId = persistedWorkspaceIdSchema.parse(input.workspaceId);
    const now = this.#now();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const stateRow = this.#database.prepare("SELECT state_json FROM workspace_task_state WHERE workspace_id = ?").get(workspaceId) as StoredWorkspaceRow | undefined;
      const state = parseStoredState(stateRow, workspaceId, now);
      const task = state.tasks.find((candidate) => candidate.id === input.taskId);
      if (!task?.importedSession) throw Object.assign(new Error("Task is not linked to an imported Session"), { code: "SESSION_IMPORT_NOT_FOUND" });
      if (task.importedSession.status === "unlinked") throw Object.assign(new Error("Session is unlinked; explicitly import it again before refreshing"), { code: "SESSION_UNLINKED" });
      if (task.importedSession.identityKey !== input.preview.identityKey) throw Object.assign(new Error("Refreshed Session identity does not match the Task"), { code: "SESSION_IDENTITY_MISMATCH" });
      const projectionRow = this.#database.prepare(`SELECT id, task_id, latest_revision_id, state_json, created_at FROM session_projection WHERE id = ? AND workspace_id = ? AND task_id = ?`)
        .get(task.importedSession.projectionId, workspaceId, task.id) as StoredProjectionRow | undefined;
      if (!projectionRow) throw new Error("Session Projection is missing");
      const currentRow = this.#database.prepare("SELECT id, revision_json FROM session_projection_revision WHERE id = ? AND projection_id = ?")
        .get(projectionRow.latest_revision_id, projectionRow.id) as StoredProjectionRevisionRow | undefined;
      if (!currentRow) throw new Error("Current Session Projection Revision is missing");
      const current = sessionProjectionRevisionSchema.parse(JSON.parse(currentRow.revision_json) as unknown);
      const diff = compareSessionProjection(current.messages, input.preview.messages);
      const contentHash = revisionContentHash(input.preview.metadata, input.preview.messages);
      let candidate: SessionProjectionRevision | undefined;
      if (diff.status !== "unchanged") {
        const existing = this.#database.prepare(`SELECT id, revision_json FROM session_projection_revision WHERE projection_id = ? AND content_hash = ?`)
          .get(projectionRow.id, contentHash) as StoredProjectionRevisionRow | undefined;
        if (existing) candidate = sessionProjectionRevisionSchema.parse(JSON.parse(existing.revision_json) as unknown);
        else {
          const ordinalRow = this.#database.prepare("SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM session_projection_revision WHERE projection_id = ?")
            .get(projectionRow.id) as { ordinal: number };
          const ordinal = Number(ordinalRow.ordinal) + 1;
          candidate = sessionProjectionRevisionSchema.parse({
            id: `session-projection-revision-${input.preview.identityKey}-${ordinal}`,
            projectionId: projectionRow.id,
            ordinal,
            ...(input.preview.metadata.updatedAt ? { sourceUpdatedAt: input.preview.metadata.updatedAt } : {}),
            messageIds: input.preview.messages.map((message) => message.id),
            metadata: input.preview.metadata,
            messages: input.preview.messages,
            contentHash,
            createdAt: now,
          });
          this.#database.prepare(`INSERT INTO session_projection_revision (id, projection_id, ordinal, content_hash, revision_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(candidate.id, candidate.projectionId, candidate.ordinal, candidate.contentHash, JSON.stringify(candidate), candidate.createdAt);
        }
      }

      const activateCandidate = diff.status === "append-only" && candidate;
      const nextRevision = activateCandidate || current;
      const nextStatus = input.preview.resume.status === "available"
        ? task.importedSession.mode === "continue" ? "linked" as const : "read-only" as const
        : "native-unavailable" as const;
      const binding = importedSessionBindingSchema.parse({
        ...task.importedSession,
        status: nextStatus,
        currentRevisionId: nextRevision.id,
        lastReadAt: now,
      });
      const appendedMessages = activateCandidate
        ? sessionMessagesForTask(activateCandidate.messages.slice(current.messages.length), task.adapter as "codex" | "claude-code", task.agentRevisionId)
        : [];
      const nextTask = workspaceTaskStateSchema.shape.tasks.element.parse({
        ...task,
        importedSession: binding,
        ...(activateCandidate ? {
          messages: [...task.messages, ...appendedMessages.filter((message) => !task.messages.some((existing) => existing.id === message.id))],
          preview: `已从原生会话追加 ${diff.additions} 条消息`,
          updatedAt: "现在",
          updatedAtIso: now,
        } : {}),
      });
      if (activateCandidate) {
        const projection = sessionProjectionSchema.parse({
          ...JSON.parse(projectionRow.state_json),
          status: nextStatus,
          latestRevisionId: activateCandidate.id,
          updatedAt: now,
        });
        this.#database.prepare("UPDATE session_projection SET latest_revision_id = ?, state_json = ?, updated_at = ? WHERE id = ?")
          .run(activateCandidate.id, JSON.stringify(projection), now, projection.id);
      }
      const nextState = workspaceTaskStateSchema.parse({ ...state, tasks: state.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate), updatedAt: now });
      this.#database.prepare("UPDATE workspace_task_state SET state_json = ?, updated_at = ? WHERE workspace_id = ?")
        .run(JSON.stringify(nextState), now, workspaceId);
      const audit = sessionProjectionAuditSchema.parse({
        id: `session-audit-${randomUUID()}`,
        projectionId: projectionRow.id,
        action: "refresh",
        result: diff.status === "unchanged" ? "unchanged" : diff.status === "append-only" ? "appended" : "differences",
        engine: input.preview.metadata.engine,
        nativeSessionId: input.preview.metadata.nativeSessionId,
        fromRevisionId: current.id,
        ...(activateCandidate ? { toRevisionId: activateCandidate.id } : candidate ? { toRevisionId: candidate.id } : {}),
        occurredAt: now,
      });
      this.#database.prepare("INSERT INTO session_projection_audit (id, projection_id, audit_json, occurred_at) VALUES (?, ?, ?, ?)")
        .run(audit.id, audit.projectionId, JSON.stringify(audit), audit.occurredAt);
      this.#database.exec("COMMIT");
      return sessionRefreshResultSchema.parse({
        task: nextTask,
        diff,
        currentRevisionId: nextRevision.id,
        ...(diff.status === "external-differences" && candidate ? { candidateRevisionId: candidate.id } : {}),
        audit,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  activateSessionRevision(
    workspaceIdInput: string,
    taskId: string,
    revisionId: string,
    action: "rebuild" | "restore",
  ): SessionRefreshResult {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const now = this.#now();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const stateRow = this.#database.prepare("SELECT state_json FROM workspace_task_state WHERE workspace_id = ?").get(workspaceId) as StoredWorkspaceRow | undefined;
      const state = parseStoredState(stateRow, workspaceId, now);
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task?.importedSession) throw Object.assign(new Error("Task is not linked to an imported Session"), { code: "SESSION_IMPORT_NOT_FOUND" });
      const projectionRow = this.#database.prepare(`SELECT id, task_id, latest_revision_id, state_json, created_at FROM session_projection WHERE id = ? AND workspace_id = ? AND task_id = ?`)
        .get(task.importedSession.projectionId, workspaceId, task.id) as StoredProjectionRow | undefined;
      if (!projectionRow) throw new Error("Session Projection is missing");
      const currentRow = this.#database.prepare("SELECT id, revision_json FROM session_projection_revision WHERE id = ? AND projection_id = ?")
        .get(projectionRow.latest_revision_id, projectionRow.id) as StoredProjectionRevisionRow | undefined;
      const targetRow = this.#database.prepare("SELECT id, revision_json FROM session_projection_revision WHERE id = ? AND projection_id = ?")
        .get(revisionId, projectionRow.id) as StoredProjectionRevisionRow | undefined;
      if (!currentRow || !targetRow) throw new Error("Session Projection Revision is missing");
      const current = sessionProjectionRevisionSchema.parse(JSON.parse(currentRow.revision_json) as unknown);
      const target = sessionProjectionRevisionSchema.parse(JSON.parse(targetRow.revision_json) as unknown);
      const diff = compareSessionProjection(current.messages, target.messages);
      const oldImportedIds = new Set(sessionMessagesForTask(current.messages, task.adapter as "codex" | "claude-code", task.agentRevisionId).map((message) => message.id));
      const ruxOwnedMessages = task.messages.filter((message) => !oldImportedIds.has(message.id));
      const importedMessages = sessionMessagesForTask(target.messages, task.adapter as "codex" | "claude-code", task.agentRevisionId);
      const binding = importedSessionBindingSchema.parse({ ...task.importedSession, currentRevisionId: target.id, lastReadAt: now });
      const nextTask = workspaceTaskStateSchema.shape.tasks.element.parse({
        ...task,
        messages: [...importedMessages, ...ruxOwnedMessages],
        importedSession: binding,
        preview: action === "rebuild" ? "已按原生会话重建本地投影" : `已恢复本地 Revision ${target.ordinal}`,
        updatedAt: "现在",
        updatedAtIso: now,
      });
      const projection = sessionProjectionSchema.parse({ ...JSON.parse(projectionRow.state_json), latestRevisionId: target.id, updatedAt: now });
      const nextState = workspaceTaskStateSchema.parse({ ...state, tasks: state.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate), updatedAt: now });
      this.#database.prepare("UPDATE session_projection SET latest_revision_id = ?, state_json = ?, updated_at = ? WHERE id = ?")
        .run(target.id, JSON.stringify(projection), now, projection.id);
      this.#database.prepare("UPDATE workspace_task_state SET state_json = ?, updated_at = ? WHERE workspace_id = ?")
        .run(JSON.stringify(nextState), now, workspaceId);
      const audit = sessionProjectionAuditSchema.parse({
        id: `session-audit-${randomUUID()}`,
        projectionId: projection.id,
        action,
        result: action === "rebuild" ? "rebuilt" : "restored",
        engine: target.metadata.engine,
        nativeSessionId: target.metadata.nativeSessionId,
        fromRevisionId: current.id,
        toRevisionId: target.id,
        occurredAt: now,
      });
      this.#database.prepare("INSERT INTO session_projection_audit (id, projection_id, audit_json, occurred_at) VALUES (?, ?, ?, ?)")
        .run(audit.id, audit.projectionId, JSON.stringify(audit), audit.occurredAt);
      this.#database.exec("COMMIT");
      return sessionRefreshResultSchema.parse({ task: nextTask, diff, currentRevisionId: target.id, audit });
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listSessionRevisions(workspaceIdInput: string, taskId: string): SessionRevisionListResult {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const state = this.load(workspaceId);
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.importedSession) throw Object.assign(new Error("Task is not linked to an imported Session"), { code: "SESSION_IMPORT_NOT_FOUND" });
    const rows = this.#database.prepare("SELECT id, revision_json FROM session_projection_revision WHERE projection_id = ? ORDER BY ordinal DESC")
      .all(task.importedSession.projectionId) as unknown as StoredProjectionRevisionRow[];
    const audits = (this.#database.prepare("SELECT audit_json FROM session_projection_audit WHERE projection_id = ? ORDER BY occurred_at DESC")
      .all(task.importedSession.projectionId) as unknown as StoredAuditRow[])
      .map((row) => sessionProjectionAuditSchema.parse(JSON.parse(row.audit_json) as unknown));
    return sessionRevisionListResultSchema.parse({
      currentRevisionId: task.importedSession.currentRevisionId,
      revisions: rows.map((row) => {
        const revision = sessionProjectionRevisionSchema.parse(JSON.parse(row.revision_json) as unknown);
        return {
          id: revision.id,
          ordinal: revision.ordinal,
          messageCount: revision.messages.length,
          createdAt: revision.createdAt,
          ...(revision.sourceUpdatedAt ? { sourceUpdatedAt: revision.sourceUpdatedAt } : {}),
          current: revision.id === task.importedSession?.currentRevisionId,
        };
      }),
      audits,
    });
  }

  recordSessionAuditFailure(workspaceIdInput: string, taskId: string, action: "refresh" | "rebuild" | "restore"): void {
    const workspaceId = persistedWorkspaceIdSchema.parse(workspaceIdInput);
    const state = this.load(workspaceId);
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.importedSession) return;
    const audit = sessionProjectionAuditSchema.parse({
      id: `session-audit-${randomUUID()}`,
      projectionId: task.importedSession.projectionId,
      action,
      result: "failed",
      engine: task.importedSession.sessionLink.engine,
      nativeSessionId: task.importedSession.sessionLink.nativeSessionId,
      fromRevisionId: task.importedSession.currentRevisionId,
      occurredAt: this.#now(),
    });
    this.#database.prepare("INSERT INTO session_projection_audit (id, projection_id, audit_json, occurred_at) VALUES (?, ?, ?, ?)")
      .run(audit.id, audit.projectionId, JSON.stringify(audit), audit.occurredAt);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }
}
