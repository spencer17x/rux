import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { TaskStore } from "../../src/electron/task-store.ts";

const [stateRootInput, workspaceInput] = process.argv.slice(2);
if (!stateRootInput || !workspaceInput) throw new Error("Usage: seed-session-recovery-qa.mjs <state-root> <workspace>");

const stateRoot = resolve(stateRootInput);
const workspace = realpathSync(resolve(workspaceInput));
mkdirSync(stateRoot, { recursive: true });
const workspaceId = createHash("sha256").update(workspace).digest("hex").slice(0, 12);
const occurredAt = "2026-08-12T09:00:00.000Z";
const connection = { id: "cli:codex:default", kind: "official-cli", engine: "codex", label: "Codex CLI default" };
const sessionLink = {
  kind: "codex-thread",
  engine: "codex",
  providerConnectionId: connection.id,
  agentRevisionId: "builtin:codex@1",
  workspaceId,
  nativeSessionId: "thread-missing-demo",
};
const run = {
  id: "run-session-recovery",
  taskId: "session-recovery-task",
  adapter: "codex",
  status: "failed",
  prompt: "继续完成上一个 Thread 中的实现。",
  permissionMode: "acceptEdits",
  model: "Rux default",
  sessionId: sessionLink.nativeSessionId,
  sessionLink,
  resumeFrom: sessionLink,
  resumeFailure: "原 Thread 已不存在或当前 Connection 无法访问；Rux 没有自动创建替代会话。",
  error: "原 Thread 已不存在或当前 Connection 无法访问；Rux 没有自动创建替代会话。",
  agentRevisionId: "builtin:codex@1",
  providerConnection: connection,
  modelSource: "engine-default",
  modelVerificationStatus: "not-required",
  contextFiles: [],
  gitRestores: [],
  startedAt: occurredAt,
  updatedAt: occurredAt,
  finishedAt: occurredAt,
  permissionRequests: [],
  permissionDecisions: [],
  verifications: [],
  events: [{ id: "run-session-recovery:1", sequence: 1, type: "run.failed", occurredAt, payload: { type: "run.failed", runId: "run-session-recovery", error: "native thread not found" } }],
};
const store = new TaskStore(join(stateRoot, "rux-task-state.sqlite3"));
store.save({
  version: 2,
  workspaceId,
  updatedAt: occurredAt,
  tasks: [{
    id: "session-recovery-task",
    workspaceId,
    title: "继续 Native Session",
    preview: "恢复失败，等待用户选择",
    status: "failed",
    updatedAt: "刚刚",
    updatedAtIso: occurredAt,
    createdAt: occurredAt,
    agent: "Rux",
    adapter: "codex",
    agentRevisionId: "builtin:codex@1",
    providerConnection: connection,
    permissionMode: "acceptEdits",
    model: "Rux default",
    modelSource: "engine-default",
    modelVerificationStatus: "not-required",
    contextFiles: [],
    branch: "main",
    elapsed: "1s",
    tokens: "—",
    messages: [{ id: "session-recovery-user", role: "user", text: "继续完成上一个 Thread 中的实现。", time: "刚刚", createdAt: occurredAt, runId: run.id }],
    plan: [],
    activity: [],
    runs: [run],
    reviewAcceptances: [],
  }],
});
store.close();
process.stdout.write(`${JSON.stringify({ workspaceId, stateRoot })}\n`);
