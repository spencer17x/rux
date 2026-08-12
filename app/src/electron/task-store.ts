import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  agentRevisionSchema,
  builtInAgentRevisionAdapter,
  builtInAgentRevisionId,
  defaultProviderConnectionForAdapter,
  legacyProviderConnectionForAdapter,
  persistedWorkspaceIdSchema,
  workspaceTaskStateSchema,
  type AgentRevision,
  type PersistedRun,
  type PersistedRunEvent,
  type PersistedTask,
  type PersistedTaskMessage,
  type VerificationEvidence,
  type WorkspaceTaskState,
} from "../shared/protocol.ts";

type StoredWorkspaceRow = {
  state_json: string;
};

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

const TASK_STORE_SCHEMA_VERSION = 2;

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

function legacyAdapter(task: UnknownRecord, run?: UnknownRecord): "claude-code" | "codex" | "mock" {
  const candidate = stringValue(run, "adapter") ?? stringValue(task, "adapter");
  if (candidate === "claude-code" || candidate === "codex" || candidate === "mock") return candidate;
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
  return {
    ...base,
    messages: mergeMessages(current.messages, incoming.messages),
    runs: mergeRuns(current.runs, incoming.runs),
    reviewAcceptances: [...acceptances.values()].sort((left, right) =>
      left.acceptedAt.localeCompare(right.acceptedAt) || left.id.localeCompare(right.id)),
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

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }
}
