import assert from "node:assert/strict";
import test from "node:test";
import { RunPermissionGate } from "../src/electron/permission-gate.ts";

function runParams(runId, permissionMode = "acceptEdits", adapter = "rux-native") {
  return {
    runId,
    adapter,
    prompt: "Change one file",
    permissionMode,
    contextFiles: ["README.md"],
  };
}

test("blocks Workspace-write Runs until one explicit decision", async () => {
  const events = [];
  const launches = [];
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => {
      launches.push(params);
      return { runId: params.runId, adapter: params.adapter };
    },
  );

  const waiting = await gate.start(runParams("run-approved"));
  assert.equal(waiting.state, "waiting-permission");
  assert.equal(launches.length, 0);
  const requested = events.find((event) => event.type === "permission.requested");
  assert.equal(requested.request.action, "workspace.write");
  assert.deepEqual(requested.request.scope, {
    kind: "workspace",
    path: "/workspace",
    appliesTo: "this-run",
  });

  const approved = await gate.decide({
    runId: "run-approved",
    requestId: requested.request.id,
    decision: "approved",
  });
  assert.equal(approved.state, "running");
  assert.equal(launches.length, 1);
  assert.deepEqual(
    events.filter((event) => event.type === "permission.decided").map((event) => event.decision.decision),
    ["approved"],
  );
  await assert.rejects(
    gate.decide({ runId: "run-approved", requestId: requested.request.id, decision: "approved" }),
    /no longer pending/,
  );
});

test("deny and Stop never launch an Agent and emit auditable terminal decisions", async () => {
  const events = [];
  let launches = 0;
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => {
      launches += 1;
      return { runId: params.runId, adapter: params.adapter };
    },
  );

  await gate.start(runParams("run-denied"));
  const deniedRequest = events.find((event) => event.type === "permission.requested" && event.runId === "run-denied");
  const denied = await gate.decide({
    runId: "run-denied",
    requestId: deniedRequest.request.id,
    decision: "denied",
  });
  assert.equal(denied.state, "cancelled");

  await gate.start(runParams("run-stopped"));
  assert.equal(await gate.cancel("run-stopped"), true);
  assert.equal(launches, 0);
  assert.deepEqual(
    events.filter((event) => event.type === "permission.decided").map((event) => event.decision.decision),
    ["denied", "cancelled"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "run.cancelled").map((event) => event.runId),
    ["run-denied", "run-stopped"],
  );
});

test("recovers a persisted pending request before deciding after restart", async () => {
  const events = [];
  const persisted = {
    params: runParams("run-recovered"),
    request: {
      id: "permission-recovered",
      runId: "run-recovered",
      action: "workspace.write",
      scope: { kind: "workspace", path: "/workspace", appliesTo: "this-run" },
      impact: "This Run only",
      requestedAt: "2026-08-11T00:00:00.000Z",
      status: "pending",
    },
  };
  let launched = false;
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => {
      launched = true;
      return { runId: params.runId, adapter: params.adapter };
    },
    (runId, requestId) => runId === persisted.params.runId
      && (!requestId || requestId === persisted.request.id) ? persisted : undefined,
  );

  const result = await gate.decide({
    runId: "run-recovered",
    requestId: "permission-recovered",
    decision: "approved",
  });
  assert.equal(result.state, "running");
  assert.equal(launched, true);
  assert.equal(events[0].type, "permission.decided");
});

test("read-only and no-prompt policies do not create a false approval request", async () => {
  const events = [];
  const launched = [];
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => {
      launched.push(params.permissionMode);
      return { runId: params.runId, adapter: params.adapter };
    },
  );

  assert.equal((await gate.start(runParams("run-plan", "plan"))).state, "running");
  assert.equal((await gate.start(runParams("run-no-prompt", "dontAsk"))).state, "running");
  assert.deepEqual(launched, ["plan", "dontAsk"]);
  assert.equal(events.length, 0);
});

test("Codex workspace-write Runs rely on provider-native approvals without a coarse gate", async () => {
  const events = [];
  const launched = [];
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => {
      launched.push(params);
      return { runId: params.runId, adapter: params.adapter };
    },
  );

  const result = await gate.start({
    ...runParams("run-codex-native", "acceptEdits", "codex"),
    reasoningEffort: "high",
  });
  assert.equal(result.state, "running");
  assert.equal(launched.length, 1);
  assert.equal(launched[0].reasoningEffort, "high");
  assert.equal(events.length, 0);
});

test("Claude Code workspace-write Runs rely on provider-native approvals without a coarse gate", async () => {
  const events = [];
  const launched = [];
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => {
      launched.push(params);
      return { runId: params.runId, adapter: params.adapter };
    },
  );

  const result = await gate.start(runParams("run-claude-native", "acceptEdits", "claude-code"));
  assert.equal(result.state, "running");
  assert.equal(launched.length, 1);
  assert.equal(events.length, 0);
});

test("bridges a provider-native tool request to one scoped allow decision", async () => {
  const events = [];
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => ({ runId: params.runId, adapter: params.adapter }),
  );
  const input = { command: "npm test", description: "Run the test suite" };
  const pendingDecision = gate.requestProviderTool({
    provider: "claude-code",
    providerRequestId: "provider-request-1",
    runId: "run-provider-allow",
    toolName: "Bash",
    input,
  }, new AbortController().signal);

  const requested = events.find((event) => event.type === "permission.requested");
  assert.equal(requested.request.action, "command.execute");
  assert.equal(requested.request.provider, "claude-code");
  assert.equal(requested.request.providerRequestId, "provider-request-1");
  assert.deepEqual(requested.request.scope, {
    kind: "tool",
    path: "npm test",
    appliesTo: "single-action",
  });

  const result = await gate.decide({
    runId: "run-provider-allow",
    requestId: requested.request.id,
    decision: "approved",
  });
  assert.equal(result.state, "running");
  assert.deepEqual(await pendingDecision, { behavior: "allow", updatedInput: input });
  assert.equal(events.at(-1).type, "permission.decided");
  assert.equal(events.at(-1).decision.decision, "approved");
});

test("provider-native deny and Run cancellation fail closed without losing the audit trail", async () => {
  const events = [];
  const gate = new RunPermissionGate(
    "/workspace",
    (event) => events.push(event),
    async (params) => ({ runId: params.runId, adapter: params.adapter }),
  );

  const deniedPromise = gate.requestProviderTool({
    provider: "claude-code",
    providerRequestId: "provider-request-denied",
    runId: "run-provider-deny",
    toolName: "Write",
    input: { file_path: "/workspace/src/app.ts" },
  }, new AbortController().signal);
  const deniedRequest = events.find((event) => event.type === "permission.requested");
  await gate.decide({
    runId: "run-provider-deny",
    requestId: deniedRequest.request.id,
    decision: "denied",
  });
  assert.equal((await deniedPromise).behavior, "deny");

  const controller = new AbortController();
  const cancelledPromise = gate.requestProviderTool({
    provider: "claude-code",
    providerRequestId: "provider-request-cancelled",
    runId: "run-provider-cancel",
    toolName: "WebFetch",
    input: { url: "https://example.com" },
  }, controller.signal);
  assert.equal(await gate.cancel("run-provider-cancel"), false);
  assert.equal((await cancelledPromise).behavior, "deny");
  assert.deepEqual(
    events.filter((event) => event.type === "permission.decided").map((event) => event.decision.decision),
    ["denied", "cancelled"],
  );
});
