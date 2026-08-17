import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BoardStore } from "../src/electron/board-store.ts";

const at = "2026-08-17T08:00:00.000Z";

function task(status = "waiting", runs = [], id = "task-1") {
  return {
    id,
    workspaceId: "workspace-1",
    title: "Implement board",
    preview: "Board work",
    status,
    updatedAt: "现在",
    updatedAtIso: at,
    createdAt: at,
    agent: "Codex",
    adapter: "codex",
    agentRevisionId: "builtin:codex@1",
    providerConnection: { id: "cli:codex:default", kind: "official-cli", engine: "codex", label: "Codex CLI default" },
    permissionMode: "acceptEdits",
    model: "Codex default",
    modelSource: "engine-default",
    modelVerificationStatus: "unverified",
    contextFiles: [],
    branch: "main",
    elapsed: "—",
    tokens: "—",
    messages: [],
    plan: [],
    activity: [],
    runs,
    reviewAcceptances: [],
    handoffTargets: [],
  };
}

function run(status) {
  return { id: "run-1", status, permissionRequests: [], permissionDecisions: [] };
}

test("Board Store creates one Task card and advances only to review", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-board-"));
  const store = new BoardStore(join(directory, "boards.json"));
  let board = store.load("project-1", [task()]);
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].stateId, "todo");

  board = store.load("project-1", [task("running", [run("running")])]);
  assert.equal(board.items[0].stateId, "in-progress");
  board = store.load("project-1", [task("completed", [run("completed")])]);
  assert.equal(board.items[0].stateId, "review");
  assert.equal(board.transitions.filter((transition) => transition.source === "run-rule").length, 3);

  board = store.mutate({ projectId: "project-1", expectedRevision: board.revision, mutation: { action: "move-item", itemId: "task:task-1", stateId: "done" } }, [task("completed", [run("completed")])]);
  board = store.load("project-1", [task("failed", [run("failed")])]);
  assert.equal(board.items[0].stateId, "done");
  assert.equal(board.items[0].automationMode, "manual");
});

test("Board requirements validate Project Task links and optimistic revisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-board-links-"));
  const store = new BoardStore(join(directory, "boards.json"));
  let board = store.load("project-1", [task()]);
  const revision = board.revision;
  board = store.mutate({ projectId: "project-1", expectedRevision: revision, mutation: { action: "create-requirement", title: "Ship K1", linkedTaskIds: ["task-1"], acceptanceCriteria: ["Board persists"] } }, [task()]);
  assert.equal(board.items.find((item) => item.type === "requirement")?.linkedTaskIds[0], "task-1");
  assert.throws(() => store.mutate({ projectId: "project-1", expectedRevision: revision, mutation: { action: "set-enabled", enabled: false } }, [task()]), /BOARD_REVISION_CONFLICT/);
  assert.throws(() => store.mutate({ projectId: "project-1", expectedRevision: board.revision, mutation: { action: "create-requirement", title: "Cross project", linkedTaskIds: ["task-elsewhere"] } }, [task()]), /BOARD_TASK_INVALID/);
});

test("disabling a Board preserves data and stops automatic Task-card creation", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-board-disabled-"));
  const store = new BoardStore(join(directory, "boards.json"));
  let board = store.load("project-1", [task()]);
  board = store.mutate({ projectId: "project-1", expectedRevision: board.revision, mutation: { action: "set-enabled", enabled: false } }, [task()]);
  board = store.load("project-1", [task(), task("waiting", [], "task-2")]);
  assert.equal(board.enabled, false);
  assert.deepEqual(board.items.filter((item) => item.type === "task").map((item) => item.linkedTaskId), ["task-1"]);
});

test("Board columns keep stable ids while supporting rename, add, and reorder", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-board-columns-"));
  const store = new BoardStore(join(directory, "boards.json"));
  let board = store.load("project-1", [task()]);
  board = store.mutate({ projectId: "project-1", expectedRevision: board.revision, mutation: { action: "rename-state", stateId: "review", name: "等待产品验收" } }, [task()]);
  assert.equal(board.states.find((state) => state.id === "review")?.name, "等待产品验收");
  board = store.mutate({ projectId: "project-1", expectedRevision: board.revision, mutation: { action: "create-state", name: "已暂停" } }, [task()]);
  const custom = board.states.find((state) => state.semanticRole === "custom");
  const reordered = [custom.id, ...board.states.filter((state) => state.id !== custom.id).map((state) => state.id)];
  board = store.mutate({ projectId: "project-1", expectedRevision: board.revision, mutation: { action: "reorder-states", stateIds: reordered } }, [task()]);
  assert.equal([...board.states].sort((left, right) => left.order - right.order)[0].id, custom.id);
});

test("Board Store preserves a future version without overwriting it", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-board-future-"));
  const file = join(directory, "boards.json");
  const future = '{"version":99,"boards":{}}\n';
  writeFileSync(file, future, { mode: 0o600 });
  const store = new BoardStore(file);
  assert.throws(() => store.load("workspace-1", [task()]), /was preserved/);
  assert.equal(readFileSync(file, "utf8"), future);
});
