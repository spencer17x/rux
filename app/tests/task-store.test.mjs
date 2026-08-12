import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateWorkspaceTaskStateV1, TaskStore } from "../src/electron/task-store.ts";
import {
  gitRunReviewAcceptanceSchema,
  workspaceTaskStateSchema,
} from "../src/shared/protocol.ts";

const savedAt = "2026-08-10T10:00:00.000Z";

const providerConnection = {
  id: "cli:claude-code:default",
  kind: "official-cli",
  engine: "claude-code",
  label: "Claude Code CLI default",
};

const agentRevision = {
  id: "agent-revision:custom-00000000-0000-4000-8000-000000000001@1",
  profileId: "custom-00000000-0000-4000-8000-000000000001",
  revisionNumber: 1,
  origin: "profile-store",
  name: "Persistence Agent",
  description: "Persist the immutable definition",
  backend: "claude-code",
  providerConnection,
  model: "sonnet",
  modelSource: "manual",
  modelVerificationStatus: "unverified",
  reasoningEffort: "high",
  instructions: "Keep this definition with the historical Run.",
  permissionMode: "acceptEdits",
  skillIds: ["review"],
  toolIds: ["git.diff"],
  enabled: true,
  createdAt: savedAt,
};

function createTaskStore(databasePath, now = undefined) {
  return new TaskStore(
    databasePath,
    now,
    (revisionId) => revisionId === agentRevision.id ? structuredClone(agentRevision) : undefined,
  );
}

function legacyTaskState(workspaceId, status = "completed") {
  const runStatus = status === "running" ? "running" : "completed";
  return {
    version: 1,
    workspaceId,
    updatedAt: savedAt,
    tasks: [{
      id: `task-${workspaceId}`,
      workspaceId,
      title: "Persist a real task",
      preview: "Saved",
      status,
      updatedAt: "刚刚",
      updatedAtIso: savedAt,
      createdAt: savedAt,
      agent: "Claude Code",
      model: "Claude Sonnet",
      reasoningEffort: "high",
      branch: "main",
      elapsed: "2s",
      tokens: "—",
      messages: [{
        id: "message-1",
        role: "user",
        text: "Keep this after restart",
        time: "现在",
        createdAt: savedAt,
      }],
      plan: [{ label: "Persist", state: status === "running" ? "active" : "done" }],
      activity: [{
        id: "activity-1",
        kind: "edit",
        title: "Writing state",
        detail: "SQLite",
        state: status === "running" ? "active" : "done",
      }],
      runs: [{
        id: "run-1",
        taskId: `task-${workspaceId}`,
        adapter: "claude-code",
        status: runStatus,
        prompt: "Keep this after restart",
        permissionMode: "acceptEdits",
        model: "sonnet",
        reasoningEffort: "high",
        profileId: "custom-00000000-0000-4000-8000-000000000001",
        agentSnapshot: {
          id: "custom-00000000-0000-4000-8000-000000000001",
          name: "Persistence Agent",
          description: "Persist the immutable definition",
          backend: "claude-code",
          model: "sonnet",
          reasoningEffort: "high",
          instructions: "Keep this definition with the historical Run.",
          permissionMode: "acceptEdits",
          skillIds: ["review"],
          toolIds: ["git.diff"],
          enabled: true,
          createdAt: savedAt,
          updatedAt: savedAt,
        },
        contextSnapshot: {
          workspaceRoot: "/workspace-a",
          generatedAt: savedAt,
          instructions: [{
            path: "AGENTS.md",
            kind: "instructions",
            bytes: 20,
            exists: true,
            sha256: "b".repeat(64),
            content: "Use project guidance",
            truncated: false,
            binary: false,
          }],
          selectedFiles: [],
          capabilities: ["Codex"],
        },
        gitBaseline: {
          id: "baseline-1",
          runId: "run-1",
          workspaceRoot: "/workspace-a",
          createdAt: savedAt,
          treeId: "c".repeat(40),
          indexSnapshotId: "1".repeat(64),
          headId: "d".repeat(40),
          ignoredFilesExcluded: true,
        },
        gitPatch: {
          id: "patch-1",
          runId: "run-1",
          baselineId: "baseline-1",
          workspaceRoot: "/workspace-a",
          generatedAt: savedAt,
          beforeTreeId: "c".repeat(40),
          afterTreeId: "e".repeat(40),
          beforeIndexSnapshotId: "1".repeat(64),
          afterIndexSnapshotId: "1".repeat(64),
          snapshotId: "f".repeat(64),
          files: [{
            path: "src/index.ts",
            kind: "modified",
            additions: 2,
            deletions: 1,
            isBinary: false,
          }],
          totals: { files: 1, additions: 2, deletions: 1, binaryFiles: 0 },
        },
        startedAt: savedAt,
        updatedAt: savedAt,
        ...(runStatus === "completed" ? { finishedAt: savedAt, durationMs: 2_000 } : {}),
        verifications: [{
          id: "verify-1",
          runId: "run-1",
          kind: "test",
          command: "npm test",
          cwd: "/workspace-a",
          finishedAt: savedAt,
          exitCode: 0,
          status: "passed",
          log: "ok",
          redacted: false,
          truncated: false,
        }],
        events: [{
          id: "run-1:1",
          sequence: 1,
          type: "run.started",
          occurredAt: savedAt,
          payload: { type: "run.started", runId: "run-1", prompt: "Keep this after restart" },
        }],
      }],
    }],
  };
}

function taskState(workspaceId, status = "completed") {
  const state = legacyTaskState(workspaceId, status);
  state.version = 2;
  const task = state.tasks[0];
  task.adapter = "claude-code";
  task.agentProfileId = agentRevision.profileId;
  task.agentRevisionId = agentRevision.id;
  task.agentRevisionSnapshot = structuredClone(agentRevision);
  task.providerConnection = structuredClone(providerConnection);
  task.modelSource = "manual";
  task.modelVerificationStatus = "unverified";
  const run = task.runs[0];
  run.agentRevisionId = agentRevision.id;
  run.providerConnection = structuredClone(providerConnection);
  run.modelSource = "manual";
  run.modelVerificationStatus = "unverified";
  run.agentSnapshot = structuredClone(agentRevision);
  return state;
}

function createWorkspaceStateTable(database) {
  database.exec(`
    CREATE TABLE workspace_task_state (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT
  `);
}

test("upgrades an existing unversioned database without losing stored state", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-migration-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const original = legacyTaskState("workspace-legacy");
  const serialized = JSON.stringify(original);

  try {
    const legacy = new DatabaseSync(databasePath);
    createWorkspaceStateTable(legacy);
    legacy.prepare(`
      INSERT INTO workspace_task_state (workspace_id, state_json, updated_at)
      VALUES (?, ?, ?)
    `).run(original.workspaceId, serialized, original.updatedAt);
    assert.equal(legacy.prepare("PRAGMA user_version").get().user_version, 0);
    legacy.close();

    const store = createTaskStore(databasePath);
    const loaded = store.load(original.workspaceId);
    store.close();
    assert.equal(loaded.tasks[0].messages[0].text, "Keep this after restart");

    const migrated = new DatabaseSync(databasePath);
    assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 2);
    const migratedState = JSON.parse(migrated.prepare(`
        SELECT state_json FROM workspace_task_state WHERE workspace_id = ?
      `).get(original.workspaceId).state_json);
    assert.equal(migratedState.version, 2);
    assert.equal(migratedState.tasks[0].id, original.tasks[0].id);
    assert.equal(migratedState.tasks[0].messages[0].id, original.tasks[0].messages[0].id);
    assert.equal(migratedState.tasks[0].runs[0].id, original.tasks[0].runs[0].id);
    assert.equal(migratedState.tasks[0].runs[0].events[0].id, original.tasks[0].runs[0].events[0].id);
    assert.match(migratedState.tasks[0].agentRevisionId, /^legacy-agent-revision:/);
    assert.equal(migratedState.tasks[0].providerConnection.kind, "legacy");
    assert.match(migratedState.tasks[0].providerConnection.id, /^legacy:claude-code:/);
    migrated.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects a database from a future schema version without mutating it", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-future-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const original = taskState("workspace-future");
  const serialized = JSON.stringify(original);

  try {
    const future = new DatabaseSync(databasePath);
    createWorkspaceStateTable(future);
    future.prepare(`
      INSERT INTO workspace_task_state (workspace_id, state_json, updated_at)
      VALUES (?, ?, ?)
    `).run(original.workspaceId, serialized, original.updatedAt);
    future.exec("PRAGMA user_version = 3");
    future.close();

    assert.throws(
      () => createTaskStore(databasePath),
      /schema version 3 is newer than supported version 2/,
    );

    const unchanged = new DatabaseSync(databasePath);
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 3);
    assert.equal(
      unchanged.prepare(`
        SELECT state_json FROM workspace_task_state WHERE workspace_id = ?
      `).get(original.workspaceId).state_json,
      serialized,
    );
    unchanged.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rolls back a failed migration and preserves the original schema and data", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-rollback-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const serialized = JSON.stringify(legacyTaskState("workspace-incompatible"));

  try {
    const incompatible = new DatabaseSync(databasePath);
    incompatible.exec(`
      CREATE TABLE workspace_task_state (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        required_extra TEXT NOT NULL
      ) STRICT
    `);
    incompatible.prepare(`
      INSERT INTO workspace_task_state (workspace_id, state_json, updated_at, required_extra)
      VALUES (?, ?, ?, ?)
    `).run("workspace-incompatible", serialized, savedAt, "keep-me");
    incompatible.close();

    assert.throws(
      () => createTaskStore(databasePath),
      /incompatible column layout/,
    );

    const unchanged = new DatabaseSync(databasePath);
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 0);
    const row = unchanged.prepare(`
      SELECT state_json, required_extra FROM workspace_task_state WHERE workspace_id = ?
    `).get("workspace-incompatible");
    assert.equal(row.state_json, serialized);
    assert.equal(row.required_extra, "keep-me");
    assert.deepEqual(
      unchanged.prepare("PRAGMA table_info(workspace_task_state)").all().map(({ name }) => name),
      ["workspace_id", "state_json", "updated_at", "required_extra"],
    );
    unchanged.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rolls back every row when one v1 Task snapshot cannot migrate", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-row-rollback-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const valid = legacyTaskState("workspace-valid");
  const invalid = { version: 1, workspaceId: "workspace-invalid", updatedAt: savedAt };

  try {
    const database = new DatabaseSync(databasePath);
    createWorkspaceStateTable(database);
    database.prepare(`
      INSERT INTO workspace_task_state (workspace_id, state_json, updated_at) VALUES (?, ?, ?)
    `).run(valid.workspaceId, JSON.stringify(valid), valid.updatedAt);
    database.prepare(`
      INSERT INTO workspace_task_state (workspace_id, state_json, updated_at) VALUES (?, ?, ?)
    `).run(invalid.workspaceId, JSON.stringify(invalid), invalid.updatedAt);
    database.exec("PRAGMA user_version = 1");
    const before = database.prepare(`
      SELECT workspace_id, state_json, updated_at FROM workspace_task_state ORDER BY workspace_id
    `).all();
    database.close();

    assert.throws(() => createTaskStore(databasePath), /missing its workspace identity, timestamp, or tasks/);

    const unchanged = new DatabaseSync(databasePath);
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 1);
    assert.deepEqual(
      unchanged.prepare(`
        SELECT workspace_id, state_json, updated_at FROM workspace_task_state ORDER BY workspace_id
      `).all(),
      before,
    );
    unchanged.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("persists Task, Message, Run, and event data across store reopen", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");

  try {
    const writer = createTaskStore(databasePath);
    writer.save(taskState("workspace-a"));
    writer.close();

    const reader = createTaskStore(databasePath);
    const loaded = reader.load("workspace-a");
    reader.close();

    assert.equal(loaded.tasks[0].messages[0].text, "Keep this after restart");
    assert.equal(loaded.tasks[0].runs[0].status, "completed");
    assert.equal(loaded.tasks[0].runs[0].events[0].type, "run.started");
    assert.equal(loaded.tasks[0].runs[0].verifications[0].status, "passed");
    assert.equal(
      loaded.tasks[0].runs[0].agentSnapshot.instructions,
      "Keep this definition with the historical Run.",
    );
    assert.equal(loaded.tasks[0].runs[0].contextSnapshot.instructions[0].content, "Use project guidance");
    assert.equal(loaded.tasks[0].runs[0].gitBaseline.id, "baseline-1");
    assert.equal(loaded.tasks[0].runs[0].gitPatch.files[0].path, "src/index.ts");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("persists Run-bound review evidence while accepting legacy review records", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-review-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const state = taskState("workspace-a");
  const legacyAcceptance = {
    id: "review-legacy",
    semantics: "review-only",
    snapshotId: "a".repeat(64),
    acceptedAt: savedAt,
    scope: "all",
    paths: ["README.md"],
    additions: 1,
    deletions: 0,
  };
  const runAcceptance = {
    id: "review-run-1",
    semantics: "review-only",
    snapshotId: "f".repeat(64),
    runId: "run-1",
    runPatchSnapshotId: "f".repeat(64),
    acceptedAt: savedAt,
    scope: "file",
    paths: ["src/index.ts"],
    additions: 2,
    deletions: 1,
  };
  state.tasks[0].reviewAcceptances = [legacyAcceptance, runAcceptance];

  try {
    assert.equal(workspaceTaskStateSchema.safeParse(state).success, true);
    assert.equal(gitRunReviewAcceptanceSchema.safeParse(legacyAcceptance).success, false);
    assert.equal(gitRunReviewAcceptanceSchema.safeParse(runAcceptance).success, true);

    const writer = createTaskStore(databasePath);
    writer.save(state);
    writer.close();
    const reader = createTaskStore(databasePath);
    const loaded = reader.load("workspace-a");
    reader.close();

    assert.equal(loaded.tasks[0].reviewAcceptances[0].runId, undefined);
    assert.equal(loaded.tasks[0].reviewAcceptances[1].runId, "run-1");
    assert.equal(
      loaded.tasks[0].reviewAcceptances[1].runPatchSnapshotId,
      loaded.tasks[0].runs[0].gitPatch.snapshotId,
    );

    const missingBinding = structuredClone(state);
    delete missingBinding.tasks[0].reviewAcceptances[1].runPatchSnapshotId;
    assert.equal(workspaceTaskStateSchema.safeParse(missingBinding).success, false);

    const incorrectStats = structuredClone(state);
    incorrectStats.tasks[0].reviewAcceptances[1].additions = 99;
    assert.equal(workspaceTaskStateSchema.safeParse(incorrectStats).success, false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("isolates state by workspace id", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");

  try {
    const store = createTaskStore(databasePath);
    store.save(taskState("workspace-a"));
    store.save(taskState("workspace-b"));

    assert.equal(store.load("workspace-a").tasks[0].workspaceId, "workspace-a");
    assert.equal(store.load("workspace-b").tasks[0].workspaceId, "workspace-b");
    assert.deepEqual(store.load("workspace-c").tasks, []);
    store.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("normalizes orphaned running tasks and runs to interrupted", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const interruptedAt = "2026-08-10T10:05:00.000Z";

  try {
    const writer = createTaskStore(databasePath);
    writer.save(taskState("workspace-a", "running"));
    writer.close();

    const reader = createTaskStore(databasePath, () => interruptedAt);
    const loaded = reader.load("workspace-a");
    reader.close();

    assert.equal(loaded.tasks[0].status, "interrupted");
    assert.equal(loaded.tasks[0].preview, "上次运行因 Rux 退出而中断");
    assert.equal(loaded.tasks[0].activity[0].state, "error");
    assert.equal(loaded.tasks[0].runs[0].status, "interrupted");
    assert.equal(loaded.tasks[0].runs[0].finishedAt, interruptedAt);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("preserves a blocked permission request across restart for explicit recovery", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-permission-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const pending = taskState("workspace-a");
  pending.tasks[0].status = "blocked";
  pending.tasks[0].preview = "等待权限";
  pending.tasks[0].runs[0].status = "waiting-permission";
  delete pending.tasks[0].runs[0].finishedAt;
  delete pending.tasks[0].runs[0].durationMs;
  pending.tasks[0].runs[0].permissionRequests = [{
    id: "permission-1",
    runId: "run-1",
    action: "workspace.write",
    scope: { kind: "workspace", path: "/workspace-a", appliesTo: "this-run" },
    impact: "Workspace write for this Run only",
    requestedAt: savedAt,
    status: "pending",
  }];
  pending.tasks[0].runs[0].permissionDecisions = [];

  try {
    const writer = createTaskStore(databasePath);
    writer.save(pending);
    writer.close();

    const reader = createTaskStore(databasePath, () => "2026-08-10T10:05:00.000Z");
    const loaded = reader.load("workspace-a");
    reader.close();

    assert.equal(loaded.tasks[0].status, "blocked");
    assert.equal(loaded.tasks[0].runs[0].status, "waiting-permission");
    assert.equal(loaded.tasks[0].runs[0].permissionRequests[0].status, "pending");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("interrupts an orphaned provider-native approval because its CLI callback cannot survive restart", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-provider-permission-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const pending = taskState("workspace-a");
  pending.tasks[0].status = "blocked";
  pending.tasks[0].preview = "等待 Codex 权限";
  pending.tasks[0].runs[0].status = "waiting-permission";
  delete pending.tasks[0].runs[0].finishedAt;
  delete pending.tasks[0].runs[0].durationMs;
  pending.tasks[0].runs[0].permissionRequests = [{
    id: "permission-codex-1",
    runId: "run-1",
    action: "command.execute",
    scope: { kind: "tool", path: "npm test", appliesTo: "single-action" },
    impact: "Run the test suite",
    provider: "codex",
    providerRequestId: "string:approval-1",
    toolName: "Command",
    requestedAt: savedAt,
    status: "pending",
  }];
  pending.tasks[0].runs[0].permissionDecisions = [];

  try {
    const writer = createTaskStore(databasePath);
    writer.save(pending);
    writer.close();

    const interruptedAt = "2026-08-10T10:05:00.000Z";
    const reader = createTaskStore(databasePath, () => interruptedAt);
    const loaded = reader.load("workspace-a");
    reader.close();

    const task = loaded.tasks[0];
    const run = task.runs[0];
    assert.equal(task.status, "interrupted");
    assert.equal(run.status, "interrupted");
    assert.equal(run.finishedAt, interruptedAt);
    assert.equal(run.permissionRequests[0].status, "cancelled");
    assert.equal(run.permissionDecisions[0].decision, "cancelled");
    assert.equal(run.permissionDecisions[0].source, "runtime");
    assert.equal(run.events.at(-1).type, "permission.decided");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("persists archive state and rejects a stale snapshot that would reopen it", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");

  try {
    const store = createTaskStore(databasePath);
    const original = taskState("workspace-a");
    store.save(original);

    const archived = structuredClone(original);
    archived.updatedAt = "2026-08-10T10:03:00.000Z";
    archived.tasks[0].updatedAtIso = archived.updatedAt;
    archived.tasks[0].archived = true;
    archived.tasks[0].pinned = false;
    store.save(archived);
    store.save(original);

    const loaded = store.load("workspace-a");
    assert.equal(loaded.tasks[0].archived, true);
    assert.equal(loaded.tasks[0].pinned, false);
    store.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects renderer snapshots that do not satisfy the shared schema", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-"));
  const store = createTaskStore(join(temporaryRoot, "state.sqlite3"));

  try {
    assert.throws(() => store.save({
      version: 1,
      workspaceId: "workspace-a",
      updatedAt: savedAt,
      tasks: [{ id: "missing-required-fields" }],
    }));
    const mismatched = taskState("workspace-a");
    mismatched.tasks[0].workspaceId = "workspace-b";
    assert.throws(() => store.save(mismatched), /workspaceId must match/);
  } finally {
    store.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects nonexistent, wrong-Engine, and fabricated legacy Agent Revision references", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-references-"));
  const store = createTaskStore(join(temporaryRoot, "state.sqlite3"));

  try {
    const nonexistent = taskState("workspace-nonexistent");
    nonexistent.tasks[0].agentRevisionId = "agent-revision:custom-00000000-0000-4000-8000-000000000099@1";
    delete nonexistent.tasks[0].agentRevisionSnapshot;
    nonexistent.tasks[0].runs[0].agentRevisionId = nonexistent.tasks[0].agentRevisionId;
    delete nonexistent.tasks[0].runs[0].agentSnapshot;
    assert.throws(() => store.save(nonexistent), /nonexistent Agent Revision/);

    const wrongEngine = taskState("workspace-wrong-engine");
    wrongEngine.tasks[0].adapter = "codex";
    wrongEngine.tasks[0].providerConnection = {
      id: "cli:codex:default",
      kind: "official-cli",
      engine: "codex",
      label: "Codex CLI default",
    };
    delete wrongEngine.tasks[0].agentRevisionSnapshot;
    wrongEngine.tasks[0].runs[0].adapter = "codex";
    wrongEngine.tasks[0].runs[0].providerConnection = structuredClone(wrongEngine.tasks[0].providerConnection);
    delete wrongEngine.tasks[0].runs[0].agentSnapshot;
    assert.throws(() => store.save(wrongEngine), /wrong Engine or Connection/);

    const fabricatedLegacy = migrateWorkspaceTaskStateV1(legacyTaskState("workspace-fabricated-legacy"));
    assert.throws(() => store.save(fabricatedLegacy), /unknown legacy Agent Revision/);
  } finally {
    store.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("merges stale cross-client snapshots without dropping messages, run events, or reviews", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-task-store-"));
  const databasePath = join(temporaryRoot, "state.sqlite3");
  const desktopStore = createTaskStore(databasePath);
  const tuiStore = createTaskStore(databasePath);

  try {
    const initial = taskState("workspace-a");
    desktopStore.save(initial);

    const desktopSnapshot = structuredClone(initial);
    desktopSnapshot.updatedAt = "2026-08-10T10:01:00.000Z";
    desktopSnapshot.tasks[0].updatedAtIso = desktopSnapshot.updatedAt;
    desktopSnapshot.tasks[0].messages.push({
      id: "message-desktop",
      role: "assistant",
      text: "Saved from Desktop",
      time: "现在",
      createdAt: desktopSnapshot.updatedAt,
    });
    desktopSnapshot.tasks[0].runs[0].updatedAt = desktopSnapshot.updatedAt;
    desktopSnapshot.tasks[0].runs[0].events.push({
      id: "run-1:2",
      sequence: 2,
      type: "assistant.message",
      occurredAt: desktopSnapshot.updatedAt,
      payload: { type: "assistant.message", runId: "run-1", text: "Desktop event" },
    });
    desktopSnapshot.tasks[0].runs[0].verifications.push({
      id: "verify-desktop",
      runId: "run-1",
      kind: "lint",
      command: "npm run lint",
      cwd: "/workspace-a",
      finishedAt: desktopSnapshot.updatedAt,
      exitCode: 0,
      status: "passed",
      log: "lint ok",
      redacted: false,
      truncated: false,
    });

    const tuiSnapshot = structuredClone(initial);
    tuiSnapshot.updatedAt = "2026-08-10T10:02:00.000Z";
    tuiSnapshot.tasks[0].updatedAtIso = tuiSnapshot.updatedAt;
    tuiSnapshot.tasks[0].messages.push({
      id: "message-tui",
      role: "assistant",
      text: "Saved from TUI",
      time: "现在",
      createdAt: tuiSnapshot.updatedAt,
    });
    tuiSnapshot.tasks[0].runs[0].updatedAt = tuiSnapshot.updatedAt;
    delete tuiSnapshot.tasks[0].runs[0].agentSnapshot;
    delete tuiSnapshot.tasks[0].runs[0].contextSnapshot;
    delete tuiSnapshot.tasks[0].runs[0].gitBaseline;
    delete tuiSnapshot.tasks[0].runs[0].gitPatch;
    tuiSnapshot.tasks[0].runs[0].events.push({
      id: "run-1:2",
      sequence: 2,
      type: "run.completed",
      occurredAt: tuiSnapshot.updatedAt,
      payload: { type: "run.completed", runId: "run-1" },
    });
    tuiSnapshot.tasks[0].runs[0].verifications.push({
      id: "verify-tui",
      runId: "run-1",
      kind: "build",
      command: "npm run build",
      cwd: "/workspace-a",
      finishedAt: tuiSnapshot.updatedAt,
      status: "unknown",
      log: "exit code unavailable",
      redacted: false,
      truncated: false,
    });
    tuiSnapshot.tasks[0].reviewAcceptances = [{
      id: "review-tui",
      semantics: "review-only",
      snapshotId: "a".repeat(64),
      acceptedAt: tuiSnapshot.updatedAt,
      scope: "all",
      paths: ["README.md"],
      additions: 1,
      deletions: 0,
    }];

    desktopStore.save(desktopSnapshot);
    tuiStore.save(tuiSnapshot);
    const loaded = desktopStore.load("workspace-a");

    assert.deepEqual(
      loaded.tasks[0].messages.map((message) => message.id),
      ["message-1", "message-desktop", "message-tui"],
    );
    assert.deepEqual(
      loaded.tasks[0].runs[0].events.map((event) => event.type),
      ["run.started", "assistant.message", "run.completed"],
    );
    assert.deepEqual(
      loaded.tasks[0].runs[0].events.map((event) => event.sequence),
      [1, 2, 3],
    );
    assert.equal(loaded.tasks[0].reviewAcceptances[0].id, "review-tui");
    assert.deepEqual(
      loaded.tasks[0].runs[0].verifications.map((verification) => verification.id),
      ["verify-1", "verify-desktop", "verify-tui"],
    );
    assert.equal(loaded.tasks[0].runs[0].agentSnapshot.name, "Persistence Agent");
    assert.equal(loaded.tasks[0].runs[0].contextSnapshot.instructions[0].path, "AGENTS.md");
    assert.equal(loaded.tasks[0].runs[0].gitBaseline.id, "baseline-1");
    assert.equal(loaded.tasks[0].runs[0].gitPatch.id, "patch-1");

    tuiStore.save(tuiSnapshot);
    assert.equal(desktopStore.load("workspace-a").tasks[0].runs[0].events.length, 3);
  } finally {
    desktopStore.close();
    tuiStore.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
