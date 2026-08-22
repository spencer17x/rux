import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CodexAppServerAdapter,
  CodexAppServerRpcError,
  codexAppServerRequestTimeoutMs,
} from "../src/electron/codex-app-server-adapter.ts";
import { CodexRuntimeAdapter } from "../src/electron/codex-runtime-adapter.ts";
import { AuthManager } from "../src/electron/auth-manager.ts";

const fixtureSource = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-codex-app-server.mjs",
);

function fakeServer(t, scenario) {
  const directory = mkdtempSync(join(tmpdir(), `rux-codex-app-server-${scenario}-`));
  const executable = join(directory, "codex");
  const transcript = join(directory, "transcript.jsonl");
  const authState = join(directory, "auth-state.txt");
  const pluginState = join(directory, "plugin-state.json");
  copyFileSync(fixtureSource, executable);
  chmodSync(executable, 0o755);
  writeFileSync(transcript, "", "utf8");
  writeFileSync(pluginState, JSON.stringify({ documents: true, github: false }), "utf8");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    executable,
    transcript,
    authState,
    pluginState,
    options: {
      executable,
      requestTimeoutMs: 3_000,
      environment: {
        RUX_FAKE_CODEX_SCENARIO: scenario,
        RUX_FAKE_CODEX_TRANSCRIPT: transcript,
        RUX_FAKE_CODEX_AUTH_STATE: authState,
        RUX_FAKE_CODEX_PLUGIN_STATE: pluginState,
      },
    },
  };
}

function eventCollector() {
  const events = [];
  const waiters = [];
  return {
    events,
    emit(event) {
      events.push(event);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (!waiter.predicate(event)) continue;
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    },
    waitFor(predicate, timeoutMs = 3_000) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error("Timed out waiting for adapter event"));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

function transcriptMessages(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("cold Codex thread initialization uses a bounded long timeout", () => {
  assert.equal(codexAppServerRequestTimeoutMs("thread/start"), 120_000);
  assert.equal(codexAppServerRequestTimeoutMs("thread/resume"), 120_000);
  assert.equal(codexAppServerRequestTimeoutMs("turn/start"), 30_000);
  assert.equal(codexAppServerRequestTimeoutMs("thread/start", 1_234), 1_234);
});

test("syncs ChatGPT account and rate-limit state only through official App Server methods", async (t) => {
  const fake = fakeServer(t, "account-sync");
  const adapter = new CodexAppServerAdapter(fake.directory, () => undefined, fake.options);
  t.after(() => adapter.dispose());

  const synced = await adapter.syncChatGptAccount();
  assert.deepEqual({ ...synced, syncedAt: "<timestamp>" }, {
    status: "connected",
    accountType: "chatgpt",
    email: "rux-user@example.com",
    planType: "pro",
    usedPercent: 37,
    remainingPercent: 63,
    windowDurationMins: 300,
    resetsAt: 1_800_000_000,
    syncedAt: "<timestamp>",
  });
  assert.equal(Number.isNaN(Date.parse(synced.syncedAt)), false);
  const requests = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client")
    .map((entry) => entry.message);
  assert.deepEqual(requests.map((message) => message.method), [
    "initialize",
    "initialized",
    "account/read",
    "account/rateLimits/read",
  ]);
  assert.deepEqual(requests[2].params, { refreshToken: false });
});

test("lists, installs, and removes plugins through the official Codex CLI boundary", async (t) => {
  const fake = fakeServer(t, "plugins");
  const adapter = new CodexAppServerAdapter(fake.directory, () => undefined, fake.options);
  t.after(() => adapter.dispose());

  const initial = await adapter.listPlugins();
  assert.equal(initial.source, "codex-cli");
  assert.deepEqual(initial.installed.map((plugin) => plugin.pluginId), ["documents@openai-primary-runtime"]);
  assert.deepEqual(initial.available.map((plugin) => plugin.pluginId), ["github@openai-curated"]);
  assert.doesNotMatch(JSON.stringify(initial), /sourceType|path|\.codex|plugin-state/);

  const installed = await adapter.installPlugin("github@openai-curated");
  assert.deepEqual(installed.installed.map((plugin) => plugin.pluginId).sort(), [
    "documents@openai-primary-runtime",
    "github@openai-curated",
  ]);
  assert.deepEqual(installed.available, []);

  const removed = await adapter.removePlugin("documents@openai-primary-runtime");
  assert.deepEqual(removed.installed.map((plugin) => plugin.pluginId), ["github@openai-curated"]);
  assert.deepEqual(removed.available.map((plugin) => plugin.pluginId), ["documents@openai-primary-runtime"]);
});

test("detects, imports, and reads external setup through bounded App Server methods", async (t) => {
  const fake = fakeServer(t, "external-import");
  const adapter = new CodexAppServerAdapter(fake.directory, () => undefined, fake.options);
  t.after(() => adapter.dispose());

  const detected = await adapter.detectExternalConfig("cursor");
  assert.equal(detected.source, "cursor");
  assert.equal(detected.availability, "available");
  assert.equal(detected.items.length, 3);
  assert.deepEqual(detected.items.map((item) => item.itemType), ["CONFIG", "SKILLS", "SESSIONS"]);
  assert.equal(detected.items.find((item) => item.itemType === "SKILLS").itemCount, 2);
  assert.equal(JSON.stringify(detected).includes("/fake/session.jsonl"), false);

  const imported = await adapter.importExternalConfig("cursor", detected.detectionId, detected.items.slice(0, 2).map((item) => item.id));
  assert.equal(imported.source, "cursor");
  assert.equal(imported.successes.length, 2);
  assert.deepEqual(imported.failures, []);

  const history = await adapter.externalConfigHistory();
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].source, "cursor");
  assert.equal(history.records[0].successes.length, 2);

  const requests = transcriptMessages(fake.transcript).filter((entry) => entry.direction === "client").map((entry) => entry.message);
  const detectRequest = requests.find((message) => message.method === "externalAgentConfig/detect");
  assert.deepEqual(detectRequest.params, { migrationSource: "cursor", includeHome: true, cwds: [fake.directory], maxSessions: 50, maxSessionAgeDays: 30 });
  const importRequest = requests.find((message) => message.method === "externalAgentConfig/import");
  assert.equal(importRequest.params.providerId, "cursor");
  assert.equal(importRequest.params.source, "rux-desktop");
  assert.equal(importRequest.params.migrationItems.length, 2);
});

async function waitUntil(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("logs in through the fake Codex CLI, resumes one thread, and edits only the temporary workspace", async (t) => {
  const fake = fakeServer(t, "runtime-echo");
  fake.options.environment.RUX_FAKE_CODEX_REQUIRE_AUTH = "1";
  const previousCodexOverride = process.env.CODEX_CLI_PATH;
  const previousClaudeOverride = process.env.CLAUDE_CODE_PATH;
  const previousAuthState = process.env.RUX_FAKE_CODEX_AUTH_STATE;
  process.env.CODEX_CLI_PATH = fake.executable;
  process.env.CLAUDE_CODE_PATH = fake.executable;
  process.env.RUX_FAKE_CODEX_AUTH_STATE = fake.authState;

  const authManager = new AuthManager(fake.directory);
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);

  t.after(async () => {
    await adapter.dispose();
    await authManager.dispose();
    if (previousCodexOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousCodexOverride;
    if (previousClaudeOverride === undefined) delete process.env.CLAUDE_CODE_PATH;
    else process.env.CLAUDE_CODE_PATH = previousClaudeOverride;
    if (previousAuthState === undefined) delete process.env.RUX_FAKE_CODEX_AUTH_STATE;
    else process.env.RUX_FAKE_CODEX_AUTH_STATE = previousAuthState;
  });

  const beforeLogin = authManager.status().providers.find((provider) => provider.id === "chatgpt");
  assert.equal(beforeLogin?.status, "signed-out");
  const afterLogin = (await authManager.login("chatgpt")).providers
    .find((provider) => provider.id === "chatgpt");
  assert.equal(afterLogin?.status, "connected");
  assert.equal(afterLogin?.authMethod, "chatgpt");

  const first = await adapter.start({
    runId: "login-coding-turn-1",
    prompt: "Create immutable Run review evidence.",
    permissionMode: "dontAsk",
  });
  await collector.waitFor((event) =>
    event.type === "run.completed" && event.runId === "login-coding-turn-1");
  assert.equal(
    readFileSync(join(fake.directory, "runtime-review.txt"), "utf8"),
    "runtime run evidence\n",
  );

  const second = await adapter.start({
    runId: "login-coding-turn-2",
    prompt: "Summarize the completed code change.",
    permissionMode: "plan",
    sessionId: first.threadId,
  });
  await collector.waitFor((event) =>
    event.type === "run.completed" && event.runId === "login-coding-turn-2");
  assert.equal(second.threadId, first.threadId);

  const clientMessages = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client")
    .map((entry) => entry.message);
  assert.deepEqual(
    clientMessages.filter((message) => ["thread/start", "thread/resume"].includes(message.method))
      .map((message) => message.method),
    ["thread/start", "thread/resume"],
  );
  assert.equal(
    clientMessages.find((message) => message.method === "thread/resume")?.params?.threadId,
    first.threadId,
  );
  assert.equal(
    collector.events.filter((event) => event.type === "assistant.message").length,
    2,
  );
});

test("performs the initialize/thread/start/turn/start handshake and streams rich events", async (t) => {
  const fake = fakeServer(t, "stream");
  const pastedImage = join(fake.directory, "pasted.png");
  writeFileSync(pastedImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  assert.equal(adapter.info().version, "0.144.6-fake");
  const started = await adapter.start({
    runId: "run-stream",
    prompt: "Inspect the repository",
    model: "fake-model",
    reasoningEffort: "high",
    serviceTier: "priority",
    permissionMode: "acceptEdits",
    profileId: "profile-1",
    imagePaths: [pastedImage],
  });
  assert.deepEqual(started, {
    runId: "run-stream",
    adapter: "codex",
    threadId: "thread-stream",
    turnId: "turn-stream",
  });
  await collector.waitFor((event) => event.type === "run.completed");

  const clientMessages = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client")
    .map((entry) => entry.message);
  assert.deepEqual(clientMessages.slice(0, 4).map((message) => message.method), [
    "initialize",
    "initialized",
    "thread/start",
    "turn/start",
  ]);
  assert.equal(clientMessages.some((message) => "jsonrpc" in message), false);
  assert.deepEqual(clientMessages[0].params.capabilities, {
    experimentalApi: false,
    requestAttestation: false,
  });
  assert.equal(clientMessages[2].params.approvalPolicy, "on-request");
  assert.equal(clientMessages[2].params.approvalsReviewer, "user");
  assert.equal(clientMessages[2].params.sandbox, "workspace-write");
  assert.equal(clientMessages[2].params.model, "fake-model");
  assert.equal(clientMessages[2].params.serviceTier, "priority");
  assert.equal("effort" in clientMessages[2].params, false);
  assert.equal("reasoningEffort" in clientMessages[2].params, false);
  assert.deepEqual(clientMessages[3].params.input, [
    { type: "text", text: "Inspect the repository", text_elements: [] },
    { type: "localImage", path: pastedImage },
  ]);
  assert.equal(clientMessages[3].params.model, "fake-model");
  assert.equal(clientMessages[3].params.effort, "high");
  assert.equal(clientMessages[3].params.serviceTier, "priority");

  assert.equal(
    collector.events
      .filter((event) => event.type === "assistant.message.delta")
      .map((event) => event.text)
      .join(""),
    "Hello world",
  );
  assert.equal(
    collector.events
      .filter((event) => event.type === "activity.output.delta")
      .map((event) => event.text)
      .join(""),
    "tests passed",
  );
  assert.equal(collector.events.find((event) => event.type === "assistant.message").text, "Hello world");
  assert.equal(collector.events.find((event) => event.type === "file.patch.updated").changes[0].path, "src/example.ts");
  assert.equal(collector.events.find((event) => event.type === "turn.diff.updated").diff.includes("+new"), true);
  assert.deepEqual(collector.events.find((event) => event.type === "plan.updated").items, [
    { text: "Inspect", completed: true },
    { text: "Ship", completed: false },
  ]);
  assert.deepEqual(collector.events.find((event) => event.type === "run.usage").usage, {
    source: "engine",
    scope: "task",
    aggregation: "cumulative",
    isEstimate: false,
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 5,
    reasoningOutputTokens: 2,
    totalTokens: 15,
    reportedAt: collector.events.find((event) => event.type === "run.usage").usage.reportedAt,
  });
  assert.match(collector.events.find((event) => event.type === "run.usage").usage.reportedAt, /^\d{4}-\d{2}-\d{2}T/);
  const verification = collector.events.find((event) => event.type === "verification.recorded").verification;
  assert.equal(verification.command, "npm test");
  assert.equal(verification.status, "passed");
  assert.equal(collector.events.filter((event) => event.type === "run.completed").length, 1);
});

test("starts an inline read-only code review through review/start", async (t) => {
  const fake = fakeServer(t, "review");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  const started = await adapter.start({
    runId: "run-review",
    prompt: "/review · 未提交变更",
    model: "fake-model",
    reasoningEffort: "high",
    permissionMode: "plan",
    reviewTarget: { type: "uncommittedChanges" },
  });
  assert.equal(started.threadId, "thread-review");
  assert.equal(started.turnId, "turn-review");
  await collector.waitFor((event) => event.type === "run.completed");

  const clientMessages = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client")
    .map((entry) => entry.message);
  assert.deepEqual(clientMessages.slice(0, 4).map((message) => message.method), [
    "initialize",
    "initialized",
    "thread/start",
    "review/start",
  ]);
  assert.equal(clientMessages[2].params.approvalPolicy, "never");
  assert.equal(clientMessages[2].params.sandbox, "read-only");
  assert.deepEqual(clientMessages[3].params, {
    threadId: "thread-review",
    target: { type: "uncommittedChanges" },
    delivery: "inline",
  });
  assert.equal(collector.events.find((event) => event.type === "assistant.message").text, "[P1] Review finding from the selected diff");
});

test("a failed Codex resume never falls back to a new Thread", async (t) => {
  const fake = fakeServer(t, "resume-error");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  await assert.rejects(adapter.start({
    runId: "resume-missing",
    prompt: "Continue exactly this Thread",
    permissionMode: "plan",
    sessionId: "thread-missing",
    agentRevisionId: "builtin:codex@1",
  }), /native thread not found/);
  const failed = collector.events.find((event) => event.type === "run.failed" && event.runId === "resume-missing");
  assert.equal(failed?.resumeSessionId, "thread-missing");
  const methods = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client")
    .map((entry) => entry.message.method)
    .filter((method) => method === "thread/resume" || method === "thread/start");
  assert.deepEqual(methods, ["thread/resume"]);
});

test("forwards transient assistant text only when the desktop Runtime opts in", async (t) => {
  const fake = fakeServer(t, "stream");
  const collector = eventCollector();
  const adapter = new CodexRuntimeAdapter(fake.directory, collector.emit, {
    ...fake.options,
    forwardAssistantMessageDeltas: true,
  });
  t.after(() => adapter.dispose());

  await adapter.start({
    runId: "run-runtime-stream",
    prompt: "Stream the response",
    permissionMode: "acceptEdits",
  });
  await collector.waitFor((event) => event.type === "run.completed");

  const deltas = collector.events.filter((event) => event.type === "assistant.message.delta");
  assert.equal(deltas.map((event) => event.text).join(""), "Hello world");
  assert.deepEqual(
    [...new Set(deltas.map((event) => event.itemId))],
    ["message-stream"],
  );
  assert.equal(collector.events.some((event) => event.type === "assistant.reasoning-summary.delta"), false);
  assert.equal(collector.events.some((event) => event.type === "activity.output.delta"), false);
  const finalMessage = collector.events.find((event) => event.type === "assistant.message");
  assert.equal(finalMessage?.itemId, "message-stream");
  assert.equal(finalMessage?.text, "Hello world");
});

test("lists the Codex model catalog with bounded pagination metadata", async (t) => {
  const fake = fakeServer(t, "stream");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  const first = await adapter.listModels({
    adapter: "codex",
    limit: 1,
    includeHidden: false,
  });
  assert.equal(first.adapter, "codex");
  assert.equal(first.source, "engine-catalog");
  assert.equal(Number.isNaN(Date.parse(first.fetchedAt)), false);
  assert.deepEqual(first.models, [{
      id: "fake-model",
      model: "fake-model",
      displayName: "Fake Model",
      description: "The default fake Codex model.",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Faster" },
        { reasoningEffort: "medium", description: "Balanced" },
        { reasoningEffort: "high", description: "Deeper" },
      ],
      serviceTiers: [{ id: "priority", name: "Fast", description: "Faster responses with higher usage" }],
      defaultServiceTier: "default",
    }]);
  assert.equal(first.nextCursor, "models-page-2");

  const second = await adapter.listModels({
    adapter: "codex",
    cursor: first.nextCursor,
    limit: 1,
  });
  assert.equal(second.models[0].model, "fake-fast");
  assert.equal(second.models[0].defaultReasoningEffort, "low");
  assert.equal(second.nextCursor, null);

  const requests = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client" && entry.message.method === "model/list")
    .map((entry) => entry.message.params);
  assert.deepEqual(requests, [
    { limit: 1, includeHidden: false },
    { cursor: "models-page-2", limit: 1 },
  ]);
});

test("normalizes a command approval and approves using the exact provider request id", async (t) => {
  const fake = fakeServer(t, "command-approve");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  const start = adapter.start({
    runId: "run-command",
    prompt: "Package the app",
    permissionMode: "acceptEdits",
  });
  const requested = await collector.waitFor((event) => event.type === "codex.approval.requested");
  assert.equal(requested.request.id, "approval-command-17");
  assert.equal(requested.request.kind, "command");
  assert.equal(requested.request.action, "command.execute");
  assert.equal(requested.request.command, "npm run package");
  assert.deepEqual(requested.request.availableDecisions, [
    "approved",
    "approved-for-session",
    "denied",
    "cancelled",
  ]);

  adapter.decide({
    runId: "run-command",
    requestId: requested.request.id,
    decision: "approved",
  });
  await start;
  await collector.waitFor((event) => event.type === "run.completed");

  const response = transcriptMessages(fake.transcript)
    .map((entry) => entry.message)
    .find((message) => message?.id === "approval-command-17" && !message.method);
  assert.deepEqual(response, {
    id: "approval-command-17",
    result: { decision: "accept" },
  });
  assert.equal(
    collector.events.find((event) => event.type === "codex.approval.decided").decision,
    "approved",
  );
});

test("normalizes a file approval, preserves a numeric request id, and denies it", async (t) => {
  const fake = fakeServer(t, "file-deny");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  const start = adapter.start({
    runId: "run-file",
    prompt: "Change one file",
    permissionMode: "acceptEdits",
  });
  const requested = await collector.waitFor((event) => event.type === "codex.approval.requested");
  assert.equal(requested.request.id, 42);
  assert.equal(requested.request.kind, "file-change");
  assert.equal(requested.request.action, "file.change");
  assert.deepEqual(requested.request.changedPaths, ["src/approval.ts"]);

  adapter.decide({ runId: "run-file", requestId: 42, decision: "denied" });
  await start;
  await collector.waitFor((event) => event.type === "run.completed");

  const response = transcriptMessages(fake.transcript)
    .map((entry) => entry.message)
    .find((message) => message?.id === 42 && !message.method);
  assert.equal(typeof response.id, "number");
  assert.deepEqual(response.result, { decision: "decline" });
  const activity = collector.events
    .filter((event) => event.type === "activity.completed")
    .find((event) => event.activity.id === "file-approval-item");
  assert.equal(activity.activity.state, "error");
});

test("fails closed instead of silently expanding one approval to the Codex session", async (t) => {
  const fake = fakeServer(t, "command-session-only");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  void adapter.start({
    runId: "run-session-only",
    prompt: "Package once",
    permissionMode: "acceptEdits",
  }).catch(() => undefined);
  const requested = await collector.waitFor((event) => event.type === "codex.approval.requested");
  assert.deepEqual(requested.request.availableDecisions, [
    "approved-for-session",
    "denied",
    "cancelled",
  ]);
  assert.throws(() => adapter.decide({
    runId: "run-session-only",
    requestId: requested.request.id,
    decision: "approved",
  }), /refusing to expand this decision to the session/);

  const response = transcriptMessages(fake.transcript)
    .map((entry) => entry.message)
    .find((message) => message?.id === requested.request.id && !message.method);
  assert.equal(response, undefined);
  await adapter.cancel("run-session-only");
});

test("fails the connection when Codex reuses an outstanding approval id", async (t) => {
  const fake = fakeServer(t, "duplicate-approval");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  void adapter.start({
    runId: "run-duplicate-approval",
    prompt: "Do not collide",
    permissionMode: "acceptEdits",
  }).catch(() => undefined);
  const failed = await collector.waitFor((event) => event.type === "run.failed");
  assert.match(failed.error, /reused an outstanding approval request id/);
  assert.equal(
    collector.events.filter((event) => event.type === "codex.approval.requested").length,
    1,
  );
});

test("bounds Codex JSONL lines and terminates the provider connection", async (t) => {
  const fake = fakeServer(t, "line-limit");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  void adapter.start({
    runId: "run-line-limit",
    prompt: "Bound output",
    permissionMode: "dontAsk",
  }).catch(() => undefined);
  const failed = await collector.waitFor((event) => event.type === "run.failed", 20_000);
  assert.match(failed.error, /32 MB JSONL line limit/);
});

test("answers permission grants with the requested subset and denial with an empty subset", async (t) => {
  for (const expectation of [
    { suffix: "grant", decision: "approved-for-session", scope: "session", granted: true },
    { suffix: "deny", decision: "denied", scope: "turn", granted: false },
  ]) {
    const fake = fakeServer(t, "permissions");
    const collector = eventCollector();
    const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
    t.after(() => adapter.dispose());

    const start = adapter.start({
      runId: `run-permissions-${expectation.suffix}`,
      prompt: "Request access",
      permissionMode: "acceptEdits",
    });
    const requested = await collector.waitFor((event) => event.type === "codex.approval.requested");
    assert.equal(requested.request.kind, "permissions");
    assert.equal(requested.request.action, "permissions.grant");
    assert.equal(requested.request.impact.includes("network access"), true);
    assert.deepEqual(requested.request.requestedPermissions.network, { enabled: true });

    adapter.decide({
      runId: `run-permissions-${expectation.suffix}`,
      requestId: "permissions-9",
      decision: expectation.decision,
    });
    await start;
    await collector.waitFor((event) => event.type === "run.completed");

    const response = transcriptMessages(fake.transcript)
      .map((entry) => entry.message)
      .find((message) => message?.id === "permissions-9" && !message.method);
    assert.equal(response.result.scope, expectation.scope);
    if (expectation.granted) {
      assert.deepEqual(response.result.permissions.network, { enabled: true });
      assert.deepEqual(
        response.result.permissions.fileSystem.write,
        requested.request.requestedPermissions.fileSystem.write,
      );
    } else {
      assert.deepEqual(response.result.permissions, {});
    }
    adapter.dispose();
  }
});

test("stop cancels a pending approval and interrupts the exact active turn", async (t) => {
  const fake = fakeServer(t, "stop");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
  t.after(() => adapter.dispose());

  const start = adapter.start({
    runId: "run-stop",
    prompt: "Wait for approval",
    permissionMode: "acceptEdits",
  });
  await collector.waitFor((event) => event.type === "codex.approval.requested");
  const active = await start;
  await adapter.cancel("run-stop");
  await collector.waitFor((event) => event.type === "run.cancelled");

  const messages = transcriptMessages(fake.transcript)
    .filter((entry) => entry.direction === "client")
    .map((entry) => entry.message);
  assert.deepEqual(messages.find((message) => message.id === "approval-stop-88"), {
    id: "approval-stop-88",
    result: { decision: "cancel" },
  });
  const interrupt = messages.find((message) => message.method === "turn/interrupt");
  assert.deepEqual(interrupt.params, {
    threadId: active.threadId,
    turnId: active.turnId,
  });
  assert.equal(
    collector.events.find((event) => event.type === "codex.approval.decided").decision,
    "cancelled",
  );
  assert.equal(collector.events.filter((event) => event.type === "run.cancelled").length, 1);
});

test("dispose emits one cancellation and terminates the shared app-server process", async (t) => {
  const fake = fakeServer(t, "idle");
  const collector = eventCollector();
  const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);

  await adapter.start({
    runId: "run-dispose",
    prompt: "Remain active",
    permissionMode: "plan",
  });
  adapter.dispose();
  await collector.waitFor((event) => event.type === "run.cancelled");
  await waitUntil(() => transcriptMessages(fake.transcript).some((entry) => entry.signal === "SIGTERM"));
  assert.equal(collector.events.filter((event) => event.type === "run.cancelled").length, 1);
  await assert.rejects(
    adapter.start({ runId: "after-dispose", prompt: "no", permissionMode: "plan" }),
    /disposed/,
  );
});

test("surfaces JSON-RPC and failed-turn errors once with sensitive text redacted", async (t) => {
  {
    const fake = fakeServer(t, "rpc-error");
    const collector = eventCollector();
    const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
    await assert.rejects(
      adapter.start({ runId: "run-rpc-error", prompt: "fail", permissionMode: "plan" }),
      (error) => {
        assert.equal(error instanceof CodexAppServerRpcError, true);
        assert.equal(error.code, -32042);
        assert.equal(error.method, "thread/start");
        return true;
      },
    );
    assert.equal(collector.events.filter((event) => event.type === "run.failed").length, 1);
    adapter.dispose();
  }

  {
    const fake = fakeServer(t, "turn-failed");
    const collector = eventCollector();
    const adapter = new CodexAppServerAdapter(fake.directory, collector.emit, fake.options);
    await adapter.start({
      runId: "run-turn-error",
      prompt: "fail during turn",
      permissionMode: "plan",
    });
    const failed = await collector.waitFor((event) => event.type === "run.failed");
    assert.equal(failed.error.includes("sk-proj-"), false);
    assert.equal(failed.error.includes("[REDACTED_KEY]"), true);
    const log = collector.events.find((event) => event.type === "run.log");
    assert.equal(log.message.includes("sk-proj-"), false);
    assert.equal(collector.events.filter((event) => event.type === "run.failed").length, 1);
    adapter.dispose();
  }
});
