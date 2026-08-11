import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAdapter, codexPolicy } from "../src/electron/codex-adapter.ts";

function fakeCodex(directory, body) {
  const executable = join(directory, "codex");
  writeFileSync(executable, `#!/usr/bin/env node\n${body}\n`, "utf8");
  chmodSync(executable, 0o755);
  return executable;
}

test("maps RUX permission modes without ever selecting danger-full-access", () => {
  assert.deepEqual(codexPolicy("plan"), { sandbox: "read-only", approvalPolicy: "never" });
  assert.deepEqual(codexPolicy("acceptEdits"), { sandbox: "workspace-write", approvalPolicy: "never" });
  assert.deepEqual(codexPolicy("dontAsk"), { sandbox: "workspace-write", approvalPolicy: "never" });
});

test("streams codex exec JSONL and forwards the prompt over stdin", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-codex-adapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = fakeCodex(directory, `
if (process.argv.includes('--version')) { console.log('codex-cli 9.9.9'); process.exit(0); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  console.log(JSON.stringify({type:'thread.started', thread_id:'thread-test'}));
  console.log(JSON.stringify({type:'item.completed', item:{id:'verify', type:'command_execution', command:'npm test', aggregated_output:'ok', exit_code:0, status:'completed'}}));
  console.log(JSON.stringify({type:'item.completed', item:{id:'message', type:'agent_message', text:input}}));
  console.log(JSON.stringify({type:'turn.completed', usage:{input_tokens:1,cached_input_tokens:0,output_tokens:2,reasoning_output_tokens:0}}));
});`);
  const events = [];
  const completed = new Promise((resolve, reject) => {
    const adapter = new CodexAdapter(directory, (event) => {
      events.push(event);
      if (event.type === "run.completed") resolve(adapter);
      if (event.type === "run.failed") reject(new Error(event.error));
    }, { executable });
    assert.equal(adapter.info().version, "9.9.9");
    adapter.start({ runId: "run-1", prompt: "safe prompt", permissionMode: "plan" });
  });
  const adapter = await completed;
  adapter.dispose();

  assert.equal(events[0].type, "run.started");
  assert.deepEqual(events.find((event) => event.type === "run.metadata"), {
    type: "run.metadata", runId: "run-1", sessionId: "thread-test",
  });
  assert.equal(events.find((event) => event.type === "assistant.message").text, "safe prompt");
  assert.equal(events.find((event) => event.type === "verification.recorded").verification.cwd, directory);
  assert.equal(events.find((event) => event.type === "verification.recorded").verification.status, "passed");
  assert.equal(events.filter((event) => event.type === "run.completed").length, 1);
});

test("cancels the whole Codex process group and emits run.cancelled", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-codex-cancel-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = fakeCodex(directory, `
if (process.argv.includes('--version')) { console.log('codex-cli 9.9.9'); process.exit(0); }
console.log(JSON.stringify({type:'thread.started', thread_id:'thread-cancel'}));
setInterval(() => {}, 1000);`);
  const events = [];
  await new Promise((resolve, reject) => {
    const adapter = new CodexAdapter(directory, (event) => {
      events.push(event);
      if (event.type === "run.metadata") adapter.cancel("run-cancel");
      if (event.type === "run.cancelled") resolve();
      if (event.type === "run.failed") reject(new Error(event.error));
    }, { executable });
    adapter.start({ runId: "run-cancel", prompt: "cancel me", permissionMode: "acceptEdits" });
  });
  assert.equal(events.at(-1).type, "run.cancelled");
});
