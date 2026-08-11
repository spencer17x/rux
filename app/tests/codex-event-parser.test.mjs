import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCodexJsonLine } from "../src/electron/codex-event-parser.ts";

test("normalizes official Codex thread, command, message, and usage events", () => {
  assert.deepEqual(
    normalizeCodexJsonLine("run-1", '{"type":"thread.started","thread_id":"thread-123"}'),
    [{ type: "run.metadata", runId: "run-1", sessionId: "thread-123" }],
  );
  assert.deepEqual(
    normalizeCodexJsonLine("run-1", '{"type":"item.started","item":{"id":"item-1","type":"command_execution","command":"npm test","status":"in_progress"}}'),
    [{
      type: "activity.started",
      runId: "run-1",
      activity: { id: "item-1", kind: "command", title: "运行命令", detail: "npm test", state: "active" },
    }],
  );
  assert.deepEqual(
    normalizeCodexJsonLine(
      "run-1",
      '{"type":"item.completed","item":{"id":"item-1","type":"command_execution","command":"npm test","aggregated_output":"ok","exit_code":0,"status":"completed"}}',
      { cwd: "/workspace", now: () => "2026-08-11T02:30:00.000Z" },
    ),
    [
      {
        type: "activity.completed",
        runId: "run-1",
        activity: { id: "item-1", kind: "command", title: "运行命令", detail: "npm test", state: "done" },
      },
      { type: "run.log", runId: "run-1", level: "info", message: "命令退出码 0: npm test" },
      {
        type: "verification.recorded",
        runId: "run-1",
        verification: {
          id: "item-1",
          runId: "run-1",
          kind: "test",
          command: "npm test",
          cwd: "/workspace",
          finishedAt: "2026-08-11T02:30:00.000Z",
          exitCode: 0,
          status: "passed",
          log: "ok",
          redacted: false,
          truncated: false,
        },
      },
    ],
  );
  assert.deepEqual(
    normalizeCodexJsonLine("run-1", '{"type":"item.completed","item":{"id":"item-2","type":"agent_message","text":"完成。"}}'),
    [{ type: "assistant.message", runId: "run-1", text: "完成。" }],
  );
  assert.deepEqual(
    normalizeCodexJsonLine("run-1", '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":20,"reasoning_output_tokens":5}}'),
    [
      {
        type: "run.usage",
        runId: "run-1",
        usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, reasoningOutputTokens: 5 },
      },
      { type: "run.completed", runId: "run-1" },
    ],
  );
});

test("verification evidence redacts secrets and never invents a passing result", () => {
  const events = normalizeCodexJsonLine(
    "run-secret",
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "command-secret",
        type: "command_execution",
        command: "API_KEY=top-secret npm test --token abc123",
        aggregated_output: "Authorization: Bearer bearer-secret sk-ant-abcdefghijklmnop",
        exit_code: 2,
        status: "failed",
      },
    }),
    { cwd: "/workspace", now: () => "2026-08-11T02:31:00.000Z" },
  );
  const evidence = events.find((event) => event.type === "verification.recorded").verification;
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.exitCode, 2);
  assert.equal(evidence.redacted, true);
  assert.doesNotMatch(`${evidence.command}\n${evidence.log}`, /top-secret|abc123|bearer-secret|abcdefghijklmnop/);
});

test("normalizes file changes, plans, MCP calls, and web search", () => {
  const fileChange = normalizeCodexJsonLine("run-2", JSON.stringify({
    type: "item.completed",
    item: {
      id: "edit-1",
      type: "file_change",
      status: "completed",
      changes: [{ path: "src/App.tsx", kind: "update" }, { path: "src/new.ts", kind: "add" }],
    },
  }));
  assert.equal(fileChange[0].type, "activity.completed");
  assert.equal(fileChange[0].activity.kind, "edit");
  assert.match(fileChange[0].activity.detail, /src\/App\.tsx/);

  assert.deepEqual(
    normalizeCodexJsonLine("run-2", '{"type":"item.updated","item":{"id":"todo-1","type":"todo_list","items":[{"text":"Inspect","completed":true},{"text":"Test","completed":false}]}}'),
    [{ type: "plan.updated", runId: "run-2", items: [{ text: "Inspect", completed: true }, { text: "Test", completed: false }] }],
  );
  assert.equal(
    normalizeCodexJsonLine("run-2", '{"type":"item.started","item":{"id":"mcp-1","type":"mcp_tool_call","server":"github","tool":"get_pr","status":"in_progress"}}')[0].activity.title,
    "调用 github",
  );
  assert.equal(
    normalizeCodexJsonLine("run-2", '{"type":"item.completed","item":{"id":"web-1","type":"web_search","query":"official docs"}}')[0].activity.kind,
    "read",
  );
});

test("turn failures and malformed JSON become explicit errors", () => {
  assert.deepEqual(
    normalizeCodexJsonLine("run-3", '{"type":"turn.failed","error":{"message":"approval denied"}}'),
    [{ type: "run.failed", runId: "run-3", error: "approval denied" }],
  );
  assert.deepEqual(
    normalizeCodexJsonLine("run-3", "not-json"),
    [{ type: "run.log", runId: "run-3", level: "warning", message: "Rux 返回了无法解析的 JSONL 事件" }],
  );
});
