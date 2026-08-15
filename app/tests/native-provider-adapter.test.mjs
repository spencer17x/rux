import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { NativeProviderAdapter } from "../src/electron/native-provider-adapter.ts";

test("Rux Native explicit Connection test records only Provider-reported catalog and capabilities", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-catalog-"));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://provider.example/v1/models");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    return new Response(JSON.stringify({
      data: [{ id: "fast", name: "Fast" }, { id: "quality" }, { id: "fast" }, { nope: "ignored" }],
      capabilities: { per_run_model_selection: true, reported: ["responses", "tool-calls"] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const adapter = new NativeProviderAdapter(workspace, () => undefined);
  const id = "native:rux-native:00000000-0000-4000-8000-000000000001";
  adapter.sync([{ id, label: "Test", providerType: "openai-responses", baseUrl: "https://provider.example/v1", defaultModel: "fast", apiKey: "test-key" }]);
  const result = await adapter.test(id);
  assert.equal(result.ok, true);
  assert.deepEqual(result.modelCatalog.models, [{ id: "fast", name: "Fast" }, { id: "quality" }]);
  assert.equal(result.capabilities.perRunModelSelection, true);
  assert.deepEqual(result.capabilities.reported, ["responses", "tool-calls"]);
  assert.equal("apiKey" in result, false);
});

test("Rux Native executes a Responses tool loop without an Agent CLI", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-adapter-"));
  const events = [];
  let requestCount = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-key");
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(JSON.stringify({
        id: "resp-tool",
        output: [{ type: "function_call", call_id: "call-1", name: "write_file", arguments: JSON.stringify({ path: "result.txt", content: "native works" }) }],
        usage: { input_tokens: 10, output_tokens: 4, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.previous_response_id, "resp-tool");
    assert.deepEqual(body.input, [{ type: "function_call_output", call_id: "call-1", output: "Wrote 12 bytes to result.txt" }]);
    return new Response(JSON.stringify({
      id: "resp-final",
      output: [{ type: "message", content: [{ type: "output_text", text: "完成" }] }],
      usage: { input_tokens: 6, output_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const adapter = new NativeProviderAdapter(workspace, (event) => events.push(event));
  adapter.sync([{ id: "native:rux-native:00000000-0000-4000-8000-000000000001", label: "Test", providerType: "openai-responses", baseUrl: "https://provider.example/v1", defaultModel: "gpt-test", apiKey: "test-key" }]);
  adapter.start({ runId: "run-native", adapter: "rux-native", prompt: "write it", model: "gpt-test", permissionMode: "dontAsk", profileId: "custom", agentRevisionId: "agent-revision:custom@1", providerConnectionId: "native:rux-native:00000000-0000-4000-8000-000000000001" });

  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (!events.some((event) => event.type === "run.completed")) return;
      clearTimeout(deadline);
      clearInterval(interval);
      resolve();
    }, 10);
    const deadline = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`native run timed out: ${JSON.stringify(events)}`));
    }, 2_000);
  });

  assert.equal(readFileSync(join(workspace, "result.txt"), "utf8"), "native works");
  assert.deepEqual(events.find((event) => event.type === "run.workspace-changed"), {
    type: "run.workspace-changed",
    runId: "run-native",
    source: "file-tool",
    paths: ["result.txt"],
  });
  assert.ok(events.some((event) => event.type === "assistant.message" && event.text === "完成"));
  assert.ok(events.some((event) => event.type === "run.usage" && event.usage.cachedInputTokens === 2));
  assert.equal(events.at(-1).type, "run.completed");
});

test("Rux Native streams Responses text deltas and persists one final assistant message", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-stream-"));
  const events = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    assert.match(init.headers.Accept, /text\/event-stream/);
    const encoder = new TextEncoder();
    const chunks = [
      { type: "response.created", response: { id: "resp-stream" } },
      { type: "response.output_text.delta", item_id: "message-1", delta: "流式" },
      { type: "response.output_text.delta", item_id: "message-1", delta: "完成" },
      { type: "response.completed", response: { id: "resp-stream", output: [{ type: "message", id: "message-1", content: [{ type: "output_text", text: "流式完成" }] }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const adapter = new NativeProviderAdapter(workspace, (event) => events.push(event));
  adapter.sync([{ id: "native:rux-native:00000000-0000-4000-8000-000000000001", label: "Test", providerType: "openai-responses", baseUrl: "https://provider.example/v1", defaultModel: "gpt-test", apiKey: "test-key" }]);
  adapter.start({ runId: "run-stream", adapter: "rux-native", prompt: "stream", model: "gpt-test", permissionMode: "dontAsk", agentRevisionId: "agent-revision:custom@1", providerConnectionId: "native:rux-native:00000000-0000-4000-8000-000000000001" });

  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (!events.some((event) => event.type === "run.completed")) return;
      clearTimeout(deadline);
      clearInterval(interval);
      resolve();
    }, 10);
    const deadline = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`native stream run timed out: ${JSON.stringify(events)}`));
    }, 2_000);
  });

  assert.deepEqual(events.filter((event) => event.type === "assistant.message.delta").map((event) => event.text), ["流式", "完成"]);
  assert.equal(events.filter((event) => event.type === "assistant.message").length, 1);
  assert.equal(events.find((event) => event.type === "assistant.message").text, "流式完成");
  assert.equal(events.find((event) => event.type === "run.usage").usage.totalTokens, 5);
});

test("Rux Native exposes only tools pinned by the immutable Agent Revision", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-tools-"));
  const events = [];
  const adapter = new NativeProviderAdapter(workspace, (event) => events.push(event));
  assert.deepEqual(adapter.tools("dontAsk", ["read_file"]).map((tool) => tool.name), ["read_file"]);
  assert.deepEqual(adapter.tools("plan", ["read_file", "list_files", "write_file", "run_command"]).map((tool) => tool.name), ["read_file", "list_files"]);
  const output = await adapter.runTool({
    runId: "run-tool-policy",
    adapter: "rux-native",
    prompt: "policy",
    permissionMode: "dontAsk",
    agentRevisionId: "agent-revision:custom@1",
    allowedToolIds: ["read_file"],
  }, "blocked-command", "run_command", { executable: "node", args: [] }, new AbortController().signal);
  assert.match(output, /not enabled by this immutable Agent Revision/);
  assert.equal(events.at(-1).type, "activity.completed");
  assert.equal(events.at(-1).activity.state, "error");
});

test("Rux Native write boundary rejects an existing symlink outside the workspace", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-boundary-"));
  const outside = join(mkdtempSync(join(tmpdir(), "rux-native-outside-")), "outside.txt");
  writeFileSync(outside, "outside");
  symlinkSync(outside, join(workspace, "linked.txt"));
  const adapter = new NativeProviderAdapter(workspace, () => undefined);
  await assert.rejects(() => adapter.resolveWorkspacePath("linked.txt", false), /outside the active workspace/);
});

test("Rux Native command tool runs without a shell and records bounded verification evidence", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS sandbox-exec acceptance");
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-command-"));
  const events = [];
  let requestCount = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(JSON.stringify({
        id: "resp-command",
        output: [{ type: "function_call", call_id: "command-1", name: "run_command", arguments: JSON.stringify({ executable: "node", args: ["-e", "process.stdout.write('command works')"] }) }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(init.body);
    assert.match(body.input[0].output, /Exit code: 0/);
    assert.match(body.input[0].output, /command works/);
    return new Response(JSON.stringify({
      id: "resp-command-final",
      output: [{ type: "message", content: [{ type: "output_text", text: "verified" }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const adapter = new NativeProviderAdapter(workspace, (event) => events.push(event));
  adapter.sync([{ id: "native:rux-native:00000000-0000-4000-8000-000000000001", label: "Test", providerType: "openai-responses", baseUrl: "https://provider.example/v1", defaultModel: "gpt-test", apiKey: "test-key" }]);
  adapter.start({ runId: "run-command", adapter: "rux-native", prompt: "verify", model: "gpt-test", permissionMode: "dontAsk", agentRevisionId: "agent-revision:custom@1", providerConnectionId: "native:rux-native:00000000-0000-4000-8000-000000000001" });

  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (!events.some((event) => event.type === "run.completed")) return;
      clearTimeout(deadline);
      clearInterval(interval);
      resolve();
    }, 10);
    const deadline = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`native command run timed out: ${JSON.stringify(events)}`));
    }, 3_000);
  });

  const verification = events.find((event) => event.type === "verification.recorded")?.verification;
  assert.equal(verification?.status, "passed");
  assert.equal(verification?.exitCode, 0);
  assert.equal(verification?.cwd, realpathSync(workspace));
  assert.match(verification?.command || "", /^node -e /);
  assert.equal(events.some((event) => event.type === "run.workspace-changed" && event.source === "command-tool"), true);
});

test("Rux Native command sandbox denies protected external reads, external writes and network", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS sandbox-exec acceptance");
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-command-boundary-"));
  const outside = join(mkdtempSync(join(tmpdir(), "rux-native-command-outside-")), "blocked.txt");
  writeFileSync(outside, "outside secret");
  const adapter = new NativeProviderAdapter(workspace, () => undefined);
  const writeResult = await adapter.runCommand("run-boundary", "command-boundary-write", {
    executable: "node",
    args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(outside)}, 'blocked')`],
  }, new AbortController().signal);
  assert.notEqual(writeResult.exitCode, 0);
  assert.equal(readFileSync(outside, "utf8"), "outside secret");

  const readResult = await adapter.runCommand("run-boundary", "command-boundary-read", {
    executable: "node",
    args: ["-e", `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(outside)}, 'utf8'))`],
  }, new AbortController().signal);
  assert.notEqual(readResult.exitCode, 0);
  assert.doesNotMatch(readResult.output, /outside secret/);

  const server = createServer(() => undefined);
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const networkResult = await adapter.runCommand("run-boundary", "command-boundary-network", {
    executable: "node",
    args: ["-e", `const socket=require('node:net').connect(${address.port},'127.0.0.1');socket.on('connect',()=>process.exit(0));socket.on('error',()=>process.exit(7));setTimeout(()=>process.exit(8),500)`],
  }, new AbortController().signal);
  assert.notEqual(networkResult.exitCode, 0);
});

test("Rux Native command runner enforces timeout and redacts captured output", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS sandbox-exec acceptance");
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-command-limits-"));
  const adapter = new NativeProviderAdapter(workspace, () => undefined);
  const started = Date.now();
  const timedOut = await adapter.runCommand("run-timeout", "command-timeout", {
    executable: "node",
    args: ["-e", "setInterval(()=>{},1000)"],
    timeout_ms: 1_000,
  }, new AbortController().signal);
  assert.equal(timedOut.timedOut, true);
  assert.ok(Date.now() - started < 4_000);

  const redacted = await adapter.runCommand("run-redaction", "command-redaction", {
    executable: "node",
    args: ["-e", "process.stdout.write('API_KEY=sk-proj-abcdefghijklmnop')"],
  }, new AbortController().signal);
  assert.equal(redacted.exitCode, 0);
  assert.doesNotMatch(redacted.output, /sk-proj-/);
  assert.match(redacted.output, /REDACTED/);
});
