import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NativeProviderAdapter } from "../src/electron/native-provider-adapter.ts";

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
  assert.ok(events.some((event) => event.type === "assistant.message" && event.text === "完成"));
  assert.ok(events.some((event) => event.type === "run.usage" && event.usage.cachedInputTokens === 2));
  assert.equal(events.at(-1).type, "run.completed");
});

test("Rux Native write boundary rejects an existing symlink outside the workspace", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rux-native-boundary-"));
  const outside = join(mkdtempSync(join(tmpdir(), "rux-native-outside-")), "outside.txt");
  writeFileSync(outside, "outside");
  symlinkSync(outside, join(workspace, "linked.txt"));
  const adapter = new NativeProviderAdapter(workspace, () => undefined);
  await assert.rejects(() => adapter.resolveWorkspacePath("linked.txt", false), /outside the active workspace/);
});
