import assert from "node:assert/strict";
import test from "node:test";
import {
  ClaudeSessionConnector,
  CodexSessionConnector,
  SessionConnectorError,
  SessionConnectorService,
} from "../src/electron/session-connector.ts";
import {
  officialCliProviderConnection,
  sessionListParamsSchema,
  sessionProjectionRevisionSchema,
  sessionProjectionSchema,
} from "../src/shared/protocol.ts";

const codexConnection = officialCliProviderConnection("codex");
const claudeConnection = officialCliProviderConnection("claude-code");

test("Session schemas enforce matching official CLI Connections and immutable projection revisions", () => {
  assert.equal(sessionListParamsSchema.parse({
    operationId: "list-1",
    engine: "codex",
    providerConnection: codexConnection,
  }).limit, 50);
  assert.throws(() => sessionListParamsSchema.parse({
    operationId: "list-2",
    engine: "codex",
    providerConnection: claudeConnection,
  }), /matching official CLI Connection/);
  assert.doesNotThrow(() => sessionProjectionSchema.parse({
    id: "projection-1",
    source: { engine: "codex", providerConnectionId: codexConnection.id, nativeSessionId: "thread-1" },
    taskId: "task-1",
    workspaceId: "workspace-1",
    mode: "view",
    status: "read-only",
    latestRevisionId: "projection-revision-1",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }));
  assert.doesNotThrow(() => sessionProjectionRevisionSchema.parse({
    id: "projection-revision-1",
    projectionId: "projection-1",
    ordinal: 1,
    messageIds: ["message-1"],
    metadata: { engine: "codex", providerConnectionId: codexConnection.id, nativeSessionId: "thread-1", resumeStatus: "available" },
    messages: [{ id: "message-1", role: "user", content: [{ type: "text", text: "hello" }] }],
    contentHash: "0".repeat(64),
    createdAt: "2026-08-12T00:00:00.000Z",
  }));
});

test("Codex Connector lists paginated Thread Metadata and reads normalized messages", async () => {
  const calls = [];
  const source = {
    async listThreads(cursor, limit) {
      calls.push(["list", cursor, limit]);
      return {
        data: [{
          id: "thread-1",
          preview: "Inspect runtime",
          cwd: "/workspace",
          createdAt: 1_754_960_000,
          updatedAt: "2026-08-12T01:00:00Z",
        }],
        nextCursor: "codex-page-2",
      };
    },
    async readThread(threadId) {
      calls.push(["read", threadId]);
      return {
        thread: {
          id: threadId,
          preview: "Inspect runtime",
          cwd: "/workspace",
          turns: [{ items: [
            { id: "user-1", type: "userMessage", content: [{ type: "input_text", text: "Find the bug" }] },
            { id: "assistant-1", type: "agentMessage", text: "Found it" },
            { id: "tool-1", type: "commandExecution", command: "npm test" },
          ] }],
        },
      };
    },
  };
  const connector = new CodexSessionConnector(source);
  const signal = new AbortController().signal;
  const listed = await connector.list({
    operationId: "codex-list",
    engine: "codex",
    providerConnection: codexConnection,
    cursor: null,
    limit: 1,
  }, signal);
  assert.equal(listed.sessions[0].nativeSessionId, "thread-1");
  assert.equal(listed.sessions[0].title, "Inspect runtime");
  assert.equal(listed.nextCursor, "codex-page-2");

  const read = await connector.read({
    operationId: "codex-read",
    engine: "codex",
    providerConnection: codexConnection,
    nativeSessionId: "thread-1",
    limit: 2,
  }, signal);
  assert.deepEqual(read.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(read.nextCursor, "2");
  assert.equal(read.truncated, true);
  assert.equal((await connector.checkResume({
    operationId: "codex-resume",
    engine: "codex",
    providerConnection: codexConnection,
    nativeSessionId: "thread-1",
  }, signal)).status, "available");
  assert.deepEqual(calls[0], ["list", null, 1]);
});

test("Codex Connector bounds provider titles so one oversized Thread cannot fail discovery", async () => {
  const connector = new CodexSessionConnector({
    async listThreads() { return { data: [{ id: "long-title", preview: "x".repeat(700), cwd: "/workspace" }] }; },
    async readThread() { return { thread: { id: "long-title", preview: "x".repeat(700), cwd: "/workspace", turns: [] } }; },
  });
  const result = await connector.list({ operationId: "long-title", engine: "codex", providerConnection: codexConnection, limit: 50 }, new AbortController().signal);
  assert.equal(result.sessions[0].title.length, 500);
});

test("Claude Connector uses supported SDK bridge actions for list, read, and resume checks", async () => {
  const calls = [];
  const bridge = {
    async invoke(request) {
      calls.push(request);
      if (request.action === "list") return [{
        session_id: "session-1",
        summary: "Fix auth",
        first_prompt: "Review the login flow",
        created_at: 1_754_960_000_000,
      }];
      if (request.action === "info") return { session_id: request.sessionId, summary: "Fix auth" };
      return [{
        uuid: "claude-message-1",
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
      }];
    },
  };
  const connector = new ClaudeSessionConnector("/workspace", bridge);
  const signal = new AbortController().signal;
  const listed = await connector.list({
    operationId: "claude-list",
    engine: "claude-code",
    providerConnection: claudeConnection,
    cursor: "20",
    limit: 1,
  }, signal);
  assert.equal(listed.sessions[0].nativeSessionId, "session-1");
  assert.equal(listed.nextCursor, "21");
  const read = await connector.read({
    operationId: "claude-read",
    engine: "claude-code",
    providerConnection: claudeConnection,
    nativeSessionId: "session-1",
    cursor: "0",
    limit: 50,
  }, signal);
  assert.equal(read.messages[0].content[0].text, "Done");
  assert.equal((await connector.checkResume({
    operationId: "claude-check",
    engine: "claude-code",
    providerConnection: claudeConnection,
    nativeSessionId: "session-1",
  }, signal)).status, "available");
  assert.deepEqual(calls.map((call) => call.action), ["list", "info", "read", "info"]);
  assert.equal(calls[0].offset, 20);
});

test("Session service supports cancellation, timeout, duplicate operation rejection, and sanitized errors", async () => {
  const pendingConnector = {
    engine: "codex",
    list(_params, signal) {
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("token=secret-value")), { once: true }));
    },
    read() { throw new Error("not used"); },
    checkResume() { throw new Error("not used"); },
  };
  const service = new SessionConnectorService([pendingConnector], 25);
  const params = {
    operationId: "cancel-me",
    engine: "codex",
    providerConnection: codexConnection,
    limit: 1,
  };
  const cancelled = service.list(params);
  service.cancel("cancel-me");
  await assert.rejects(cancelled, (error) => error instanceof SessionConnectorError && error.code === "SESSION_CANCELLED");

  const timedOut = service.list({ ...params, operationId: "timeout-me" });
  await assert.rejects(timedOut, (error) => error instanceof SessionConnectorError && error.code === "SESSION_TIMEOUT");

  const providerFailure = new SessionConnectorService([{
    ...pendingConnector,
    async list() { throw new Error("Authorization: Bearer sk-test-secret"); },
  }]);
  await assert.rejects(
    providerFailure.list({ ...params, operationId: "redact-me" }),
    (error) => error.code === "SESSION_PROVIDER_FAILED" && !error.message.includes("sk-test-secret") && error.message.includes("[REDACTED]"),
  );
});

test("Session Connector rejects responses over the bounded payload size", async () => {
  const connector = new CodexSessionConnector({
    async listThreads() { return { data: [] }; },
    async readThread() {
      return { thread: {
        id: "thread-large",
        turns: [{ items: Array.from({ length: 10 }, (_, index) => ({
          id: `message-${index}`,
          type: "agentMessage",
          text: "x".repeat(262_144),
        })) }],
      } };
    },
  });
  await assert.rejects(
    connector.read({
      operationId: "large",
      engine: "codex",
      providerConnection: codexConnection,
      nativeSessionId: "thread-large",
      limit: 100,
    }, new AbortController().signal),
    (error) => error.code === "SESSION_RESPONSE_TOO_LARGE",
  );
});
