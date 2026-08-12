#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.144.6-fake\n");
  process.exit(0);
}

const authStatePath = process.env.RUX_FAKE_CODEX_AUTH_STATE;

function isAuthenticated() {
  if (!authStatePath) return true;
  return existsSync(authStatePath)
    && readFileSync(authStatePath, "utf8").trim() === "connected";
}

if (process.argv[2] === "login" && process.argv[3] === "status") {
  if (isAuthenticated()) {
    process.stdout.write(process.env.RUX_FAKE_CODEX_AUTH_METHOD === "api-key"
      ? "Logged in using an API key\n"
      : "Logged in using ChatGPT\n");
    process.exit(0);
  }
  process.stdout.write("Not logged in\n");
  process.exit(1);
}

if (process.argv[2] === "login" && process.argv.length === 3) {
  if (authStatePath) writeFileSync(authStatePath, "connected\n", "utf8");
  process.exit(0);
}

if (!process.argv.includes("app-server")) {
  process.stderr.write("expected app-server\n");
  process.exit(2);
}

if (process.env.RUX_FAKE_CODEX_REQUIRE_CUSTOM_PROVIDER === "1") {
  if (
    process.env.OPENAI_BASE_URL !== "https://provider.example.invalid/v1"
    || process.env.OPENAI_API_KEY !== "sk-proj-rux-fixture-secret-123456"
  ) {
    process.stderr.write("missing fake CLI-owned custom Provider configuration\n");
    process.exit(93);
  }
}

const scenario = process.env.RUX_FAKE_CODEX_SCENARIO ?? "stream";
const transcriptPath = process.env.RUX_FAKE_CODEX_TRANSCRIPT;
const requireAuthentication = process.env.RUX_FAKE_CODEX_REQUIRE_AUTH === "1";
let threadId = `thread-${scenario}`;
let turnId = `turn-${scenario}`;
let runtimeSequence = 0;
let pendingApproval;
let completed = false;

function record(value) {
  if (!transcriptPath) return;
  appendFileSync(transcriptPath, `${JSON.stringify(value)}\n`, "utf8");
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function turn(status, error = null, durationMs = 12) {
  return {
    id: turnId,
    items: [],
    itemsView: "full",
    status,
    error,
    startedAt: 1,
    completedAt: status === "inProgress" ? null : 2,
    durationMs: status === "inProgress" ? null : durationMs,
  };
}

function completeTurn(status = "completed", error = null) {
  if (completed) return;
  completed = true;
  send({ method: "turn/completed", params: { threadId, turn: turn(status, error) } });
}

function startItem(item) {
  send({
    method: "item/started",
    params: { threadId, turnId, startedAtMs: 1_700_000_000_000, item },
  });
}

function completeItem(item) {
  send({
    method: "item/completed",
    params: { threadId, turnId, completedAtMs: 1_700_000_000_100, item },
  });
}

function emitStreamScenario() {
  const command = {
    type: "commandExecution",
    id: "command-stream",
    command: "npm test",
    cwd: process.cwd(),
    processId: null,
    source: "agent",
    status: "inProgress",
    commandActions: [],
    aggregatedOutput: null,
    exitCode: null,
    durationMs: null,
  };
  startItem(command);
  send({
    method: "item/commandExecution/outputDelta",
    params: { threadId, turnId, itemId: command.id, delta: "tests " },
  });
  send({
    method: "item/commandExecution/outputDelta",
    params: { threadId, turnId, itemId: command.id, delta: "passed" },
  });
  completeItem({
    ...command,
    status: "completed",
    aggregatedOutput: "tests passed",
    exitCode: 0,
    durationMs: 100,
  });

  const fileChange = {
    type: "fileChange",
    id: "file-stream",
    changes: [{
      path: "src/example.ts",
      kind: { type: "update", move_path: null },
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    }],
    status: "inProgress",
  };
  startItem(fileChange);
  send({
    method: "item/fileChange/patchUpdated",
    params: { threadId, turnId, itemId: fileChange.id, changes: fileChange.changes },
  });
  send({
    method: "turn/diff/updated",
    params: { threadId, turnId, diff: fileChange.changes[0].diff },
  });
  completeItem({ ...fileChange, status: "completed" });

  send({
    method: "turn/plan/updated",
    params: {
      threadId,
      turnId,
      explanation: null,
      plan: [
        { step: "Inspect", status: "completed" },
        { step: "Ship", status: "inProgress" },
      ],
    },
  });
  send({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId,
      tokenUsage: {
        total: {
          totalTokens: 15,
          inputTokens: 10,
          cachedInputTokens: 3,
          outputTokens: 5,
          reasoningOutputTokens: 2,
        },
        last: {
          totalTokens: 15,
          inputTokens: 10,
          cachedInputTokens: 3,
          outputTokens: 5,
          reasoningOutputTokens: 2,
        },
        modelContextWindow: 1000,
      },
    },
  });
  send({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: "message-stream", delta: "Hello" },
  });
  send({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: "message-stream", delta: " " },
  });
  send({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: "message-stream", delta: "world" },
  });
  completeItem({
    type: "agentMessage",
    id: "message-stream",
    text: "Hello world",
    phase: "final_answer",
    memoryCitation: null,
  });
  completeTurn("completed");
}

function emitRuntimeEchoScenario(prompt) {
  if (prompt.includes("Create immutable Run review evidence.")) {
    writeFileSync(join(process.cwd(), "runtime-review.txt"), "runtime run evidence\n", "utf8");
  }
  const command = {
    type: "commandExecution",
    id: `command-runtime-${runtimeSequence}`,
    command: "npm test",
    cwd: process.cwd(),
    processId: null,
    source: "agent",
    status: "completed",
    commandActions: [],
    aggregatedOutput: "ok",
    exitCode: 0,
    durationMs: 20,
  };
  startItem({ ...command, status: "inProgress", aggregatedOutput: null, exitCode: null, durationMs: null });
  completeItem(command);
  completeItem({
    type: "agentMessage",
    id: `message-runtime-${runtimeSequence}`,
    text: prompt,
    phase: "final_answer",
    memoryCitation: null,
  });
  completeTurn("completed");
}

function emitCommandApprovalScenario(stopOnly = false, sessionOnly = false) {
  const command = {
    type: "commandExecution",
    id: "command-approval-item",
    command: "npm run package",
    cwd: process.cwd(),
    processId: null,
    source: "agent",
    status: "inProgress",
    commandActions: [],
    aggregatedOutput: null,
    exitCode: null,
    durationMs: null,
  };
  startItem(command);
  pendingApproval = {
    id: stopOnly ? "approval-stop-88" : "approval-command-17",
    kind: "command",
    item: command,
    stopOnly,
  };
  send({
    method: "item/commandExecution/requestApproval",
    id: pendingApproval.id,
    params: {
      threadId,
      turnId,
      itemId: command.id,
      startedAtMs: 1_700_000_000_010,
      reason: "Packaging writes outside the sandbox",
      command: command.command,
      cwd: command.cwd,
      availableDecisions: sessionOnly
        ? ["acceptForSession", "decline", "cancel"]
        : ["accept", "acceptForSession", "decline", "cancel"],
    },
  });
}

function emitDuplicateApprovalScenario() {
  emitCommandApprovalScenario(false);
  send({
    method: "item/commandExecution/requestApproval",
    id: pendingApproval.id,
    params: {
      threadId,
      turnId,
      itemId: "duplicate-command-item",
      startedAtMs: 1_700_000_000_011,
      reason: "duplicate id",
      command: "echo duplicate",
      cwd: process.cwd(),
      availableDecisions: ["accept", "decline", "cancel"],
    },
  });
}

function emitFileApprovalScenario() {
  const fileChange = {
    type: "fileChange",
    id: "file-approval-item",
    changes: [{
      path: "src/approval.ts",
      kind: { type: "update", move_path: null },
      diff: "@@ -0,0 +1 @@\n+approved\n",
    }],
    status: "inProgress",
  };
  startItem(fileChange);
  pendingApproval = { id: 42, kind: "file", item: fileChange };
  send({
    method: "item/fileChange/requestApproval",
    id: pendingApproval.id,
    params: {
      threadId,
      turnId,
      itemId: fileChange.id,
      startedAtMs: 1_700_000_000_020,
      reason: "Apply one source change",
      grantRoot: process.cwd(),
    },
  });
}

function emitPermissionsApprovalScenario() {
  pendingApproval = { id: "permissions-9", kind: "permissions" };
  send({
    method: "item/permissions/requestApproval",
    id: pendingApproval.id,
    params: {
      threadId,
      turnId,
      itemId: "permissions-item",
      environmentId: null,
      startedAtMs: 1_700_000_000_030,
      cwd: process.cwd(),
      reason: null,
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: [process.cwd()],
          write: [`${process.cwd()}/generated`],
          globScanMaxDepth: 2,
        },
      },
    },
  });
}

function handleApprovalResponse(message) {
  if (!pendingApproval || message.id !== pendingApproval.id || !("result" in message)) return false;
  const approval = pendingApproval;
  pendingApproval = undefined;
  send({
    method: "serverRequest/resolved",
    params: { threadId, requestId: approval.id },
  });
  if (approval.stopOnly) return true;

  if (approval.kind === "command") {
    const decision = message.result?.decision;
    const accepted = decision === "accept" || decision === "acceptForSession";
    completeItem({
      ...approval.item,
      status: accepted ? "completed" : "declined",
      aggregatedOutput: accepted ? "packaged" : "",
      exitCode: accepted ? 0 : null,
      durationMs: 50,
    });
    completeTurn("completed");
    return true;
  }
  if (approval.kind === "file") {
    const decision = message.result?.decision;
    const accepted = decision === "accept" || decision === "acceptForSession";
    completeItem({ ...approval.item, status: accepted ? "completed" : "declined" });
    completeTurn("completed");
    return true;
  }
  if (approval.kind === "permissions") {
    const granted = message.result?.permissions && Object.keys(message.result.permissions).length > 0;
    completeItem({
      type: "agentMessage",
      id: "permissions-result",
      text: granted ? "Permissions granted" : "Permissions denied",
      phase: "final_answer",
      memoryCitation: null,
    });
    completeTurn("completed");
    return true;
  }
  return false;
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write("invalid client JSON\n");
    process.exit(3);
  }
  record({ direction: "client", message });

  if (handleApprovalResponse(message)) return;
  if (message.method === "initialize") {
    send({
      id: message.id,
      result: {
        userAgent: "fake-codex-app-server/0.144.6",
        codexHome: "/tmp/fake-codex-home",
        platformFamily: "unix",
        platformOs: "macos",
      },
    });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "model/list") {
    const secondPage = message.params?.cursor === "models-page-2";
    const model = secondPage
      ? {
          id: "fake-fast",
          model: "fake-fast",
          displayName: "Fake Fast",
          description: "A faster fake model.",
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Faster" },
            { reasoningEffort: "medium", description: "Balanced" },
          ],
          defaultReasoningEffort: "low",
          inputModalities: ["text"],
          supportsPersonality: false,
          isDefault: false,
        }
      : {
          id: "fake-model",
          model: "fake-model",
          displayName: "Fake Model",
          description: "The default fake Codex model.",
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Faster" },
            { reasoningEffort: "medium", description: "Balanced" },
            { reasoningEffort: "high", description: "Deeper" },
          ],
          defaultReasoningEffort: "medium",
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          isDefault: true,
        };
    send({
      id: message.id,
      result: {
        data: [model],
        nextCursor: secondPage ? null : "models-page-2",
      },
    });
    return;
  }
  if (message.method === "thread/start" || message.method === "thread/resume") {
    if (requireAuthentication && !isAuthenticated()) {
      send({
        id: message.id,
        error: { code: -32001, message: "fake Codex account is not logged in" },
      });
      return;
    }
    if (scenario === "rpc-error") {
      send({
        id: message.id,
        error: { code: -32042, message: "fake thread initialization failed" },
      });
      return;
    }
    if (scenario === "runtime-echo") {
      runtimeSequence += 1;
      threadId = message.method === "thread/resume"
        ? message.params?.threadId
        : `thread-runtime-${runtimeSequence}`;
      turnId = `turn-runtime-${runtimeSequence}`;
      completed = false;
      pendingApproval = undefined;
    }
    send({
      id: message.id,
      result: {
        thread: { id: threadId, sessionId: threadId },
        model: message.params?.model ?? "fake-model",
        cwd: process.cwd(),
      },
    });
    send({
      method: "thread/started",
      params: { thread: { id: threadId, sessionId: threadId } },
    });
    return;
  }
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: turn("inProgress") } });
    send({ method: "turn/started", params: { threadId, turn: turn("inProgress") } });
    if (scenario === "stream") emitStreamScenario();
    else if (scenario === "runtime-echo") {
      const prompt = Array.isArray(message.params?.input)
        ? message.params.input.map((item) => typeof item?.text === "string" ? item.text : "").join("\n")
        : "";
      if (prompt.includes("Proceed after approval.")) emitCommandApprovalScenario(false);
      else if (prompt.includes("Wait and stop.")) emitCommandApprovalScenario(true);
      else emitRuntimeEchoScenario(prompt);
    }
    else if (scenario === "command-approve") emitCommandApprovalScenario(false);
    else if (scenario === "command-session-only") emitCommandApprovalScenario(false, true);
    else if (scenario === "duplicate-approval") emitDuplicateApprovalScenario();
    else if (scenario === "line-limit") process.stdout.write("x".repeat(4 * 1024 * 1024 + 1));
    else if (scenario === "file-deny") emitFileApprovalScenario();
    else if (scenario === "permissions") emitPermissionsApprovalScenario();
    else if (scenario === "stop") emitCommandApprovalScenario(true);
    else if (scenario === "turn-failed") {
      send({
        method: "error",
        params: {
          threadId,
          turnId,
          willRetry: false,
          error: {
            message: "upstream rejected sk-proj-abcdefghijklmnop",
            codexErrorInfo: null,
            additionalDetails: null,
          },
        },
      });
      completeTurn("failed", {
        message: "upstream rejected sk-proj-abcdefghijklmnop",
        codexErrorInfo: null,
        additionalDetails: null,
      });
    }
    return;
  }
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    completeTurn("interrupted");
  }
});

process.on("SIGTERM", () => {
  record({ signal: "SIGTERM" });
  process.exit(0);
});
