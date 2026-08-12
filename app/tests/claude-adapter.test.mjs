import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClaudeCodeAdapter } from "../src/electron/claude-adapter.ts";

test("starts a fresh Claude session and resumes an existing session without losing metadata", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-claude-resume-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, "claude");
  const invocationsPath = join(directory, "invocations.jsonl");
  writeFileSync(executable, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
if (process.argv.includes('--version')) { console.log('2.1.206'); process.exit(0); }
const args = process.argv.slice(2);
appendFileSync(process.env.RUX_FAKE_INVOCATIONS_PATH, JSON.stringify(args) + '\\n');
const resumeIndex = args.indexOf('--resume');
const init = {
  type: 'system',
  subtype: 'init',
  model: 'claude-test',
  permissionMode: 'dontAsk',
  cwd: process.cwd(),
  claude_code_version: '2.1.206',
};
if (resumeIndex < 0) init.session_id = 'fresh-session-id';
console.log(JSON.stringify(init));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));
`, "utf8");
  chmodSync(executable, 0o755);

  const previousPath = process.env.RUX_FAKE_INVOCATIONS_PATH;
  process.env.RUX_FAKE_INVOCATIONS_PATH = invocationsPath;
  t.after(() => {
    if (previousPath === undefined) delete process.env.RUX_FAKE_INVOCATIONS_PATH;
    else process.env.RUX_FAKE_INVOCATIONS_PATH = previousPath;
  });

  const events = [];
  const terminalWaiters = new Map();
  const adapter = new ClaudeCodeAdapter(directory, (event) => {
    events.push(event);
    if (!("runId" in event) || !["run.completed", "run.failed", "run.cancelled"].includes(event.type)) return;
    const waiter = terminalWaiters.get(event.runId);
    if (!waiter) return;
    terminalWaiters.delete(event.runId);
    if (event.type === "run.completed") waiter.resolve();
    else waiter.reject(new Error(event.type === "run.failed" ? event.error : "Run was cancelled"));
  }, { executable });
  t.after(() => adapter.dispose());

  const startAndWait = (params) => new Promise((resolve, reject) => {
    terminalWaiters.set(params.runId, { resolve, reject });
    try {
      adapter.start(params);
    } catch (error) {
      terminalWaiters.delete(params.runId);
      reject(error);
    }
  });

  await startAndWait({
    runId: "fresh-run",
    prompt: "Start fresh",
    permissionMode: "dontAsk",
  });
  await startAndWait({
    runId: "resumed-run",
    prompt: "Continue the task",
    permissionMode: "dontAsk",
    sessionId: "existing-session-id",
  });

  const invocations = readFileSync(invocationsPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].includes("--resume"), false);
  const resumeIndex = invocations[1].indexOf("--resume");
  assert.notEqual(resumeIndex, -1);
  assert.equal(invocations[1][resumeIndex + 1], "existing-session-id");

  const freshMetadata = events.find((event) => event.type === "run.metadata" && event.runId === "fresh-run");
  const resumedMetadata = events.find((event) => event.type === "run.metadata" && event.runId === "resumed-run");
  assert.equal(freshMetadata.sessionId, "fresh-session-id");
  assert.equal(resumedMetadata.sessionId, "existing-session-id");
  const resumedStarted = events.find((event) => event.type === "run.started" && event.runId === "resumed-run");
  assert.equal(resumedStarted.resumeSessionId, "existing-session-id");
});

test("fails and terminates Claude when one JSONL line exceeds the bounded buffer", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-claude-line-limit-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, "claude");
  writeFileSync(executable, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('2.1.206'); process.exit(0); }
process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
setInterval(() => {}, 1000);
`, "utf8");
  chmodSync(executable, 0o755);

  const events = [];
  let adapter;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Claude adapter did not enforce its line limit")), 5_000);
    adapter = new ClaudeCodeAdapter(directory, (event) => {
      events.push(event);
      if (event.type !== "run.failed") return;
      clearTimeout(timeout);
      resolve();
    }, { executable });
    adapter.start({ runId: "run-line-limit", prompt: "bounded", permissionMode: "dontAsk" });
  });

  assert.equal(events.filter((event) => event.type === "run.failed").length, 1);
  assert.match(events.find((event) => event.type === "run.failed").error, /4 MB line limit/);
  await adapter.dispose();
});
