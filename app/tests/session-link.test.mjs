import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeSessionLink,
  latestCompatibleSessionLink,
  resumeFailureForTask,
  sessionLinkCompatible,
} from "../src/session-link.js";
import { persistedRunSchema, persistedTaskSchema } from "../src/shared/protocol.ts";

const connection = { id: "cli:codex:default", kind: "official-cli", engine: "codex", label: "Codex CLI default" };
const link = createNativeSessionLink({
  adapter: "codex",
  providerConnection: connection,
  agentRevisionId: "builtin:codex@1",
  workspaceId: "workspace-a",
  sessionId: "thread-1",
});

function run(overrides = {}) {
  return {
    id: "run-1",
    taskId: "task-1",
    adapter: "codex",
    status: "completed",
    prompt: "continue",
    permissionMode: "plan",
    sessionId: "thread-1",
    sessionLink: link,
    agentRevisionId: "builtin:codex@1",
    providerConnection: connection,
    modelSource: "engine-default",
    modelVerificationStatus: "not-required",
    contextFiles: [],
    gitRestores: [],
    startedAt: "2026-08-12T01:00:00.000Z",
    updatedAt: "2026-08-12T01:01:00.000Z",
    permissionRequests: [],
    permissionDecisions: [],
    verifications: [],
    events: [],
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: "task-1",
    workspaceId: "workspace-a",
    title: "Task",
    preview: "Ready",
    status: "completed",
    updatedAt: "现在",
    agent: "Rux",
    adapter: "codex",
    agentRevisionId: "builtin:codex@1",
    providerConnection: connection,
    model: "Rux default",
    modelSource: "engine-default",
    modelVerificationStatus: "not-required",
    branch: "main",
    elapsed: "1s",
    tokens: "1",
    messages: [],
    plan: [],
    activity: [],
    runs: [run()],
    reviewAcceptances: [],
    ...overrides,
  };
}

test("Native Session compatibility requires the same Engine, Connection, Revision, and Workspace", () => {
  const fixedTask = task();
  assert.equal(sessionLinkCompatible(link, fixedTask), true);
  for (const incompatible of [
    { ...fixedTask, adapter: "claude-code" },
    { ...fixedTask, providerConnection: { ...connection, id: "connection-b" } },
    { ...fixedTask, agentRevisionId: "builtin:codex@2" },
    { ...fixedTask, workspaceId: "workspace-b" },
  ]) assert.equal(sessionLinkCompatible(link, incompatible), false);
});

test("latest compatible Session ignores newer incompatible history", () => {
  const incompatible = { ...link, providerConnectionId: "connection-b", nativeSessionId: "thread-wrong" };
  const fixedTask = task({ runs: [run(), run({ id: "run-2", sessionId: "thread-wrong", sessionLink: incompatible })] });
  assert.equal(latestCompatibleSessionLink(fixedTask)?.nativeSessionId, "thread-1");
});

test("an imported Task never resumes the source Session and later resumes only its Rux-owned Session", () => {
  const imported = task({
    runs: [],
    importedSession: {
      identityKey: "a".repeat(64),
      source: "codex-import",
      mode: "continue",
      status: "linked",
      projectionId: "projection-1",
      currentRevisionId: "revision-1",
      sessionLink: link,
      importedAt: "2026-08-12T00:00:00.000Z",
      lastReadAt: "2026-08-12T00:00:00.000Z",
    },
  });
  assert.equal(latestCompatibleSessionLink(imported), undefined);
  const ruxOwned = { ...link, nativeSessionId: "thread-rux-owned" };
  assert.equal(latestCompatibleSessionLink({ ...imported, runs: [run({ sessionId: "thread-rux-owned", sessionLink: ruxOwned })] })?.nativeSessionId, "thread-rux-owned");
});

test("resume failure is explicit and remains tied to the attempted Session", () => {
  const failed = run({ status: "failed", resumeFrom: link, resumeFailure: "thread not found", error: "thread not found" });
  const recovery = resumeFailureForTask(task({ status: "failed", runs: [failed] }));
  assert.equal(recovery?.link.nativeSessionId, "thread-1");
  assert.equal(recovery?.error, "thread not found");
  assert.equal(persistedRunSchema.parse(failed).resumeFrom.nativeSessionId, "thread-1");
});

test("persisted Task rejects cross-Connection, cross-Revision, and cross-Workspace Session references", () => {
  assert.equal(persistedTaskSchema.safeParse(task()).success, true);
  assert.equal(persistedTaskSchema.safeParse(task({ runs: [run({ sessionLink: { ...link, providerConnectionId: "connection-b" } })] })).success, false);
  assert.equal(persistedTaskSchema.safeParse(task({ runs: [run({ sessionLink: { ...link, agentRevisionId: "builtin:codex@2" } })] })).success, false);
  assert.equal(persistedTaskSchema.safeParse(task({ runs: [run({ sessionLink: { ...link, workspaceId: "workspace-b" } })] })).success, false);
});
