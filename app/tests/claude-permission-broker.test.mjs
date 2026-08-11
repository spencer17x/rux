import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ClaudeCodeAdapter } from "../src/electron/claude-adapter.ts";

function fakeClaude(directory) {
  const executable = join(directory, "claude");
  writeFileSync(executable, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { createInterface } = require('node:readline');

if (process.argv.includes('--version')) {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

(async () => {
  const configPath = valueAfter('--mcp-config');
  const permissionTool = valueAfter('--permission-prompt-tool');
  writeFileSync(process.env.RUX_FAKE_ARGS_PATH, JSON.stringify({
    args: process.argv.slice(2),
    configPath,
    permissionTool,
  }));
  if (!configPath || !permissionTool) throw new Error('permission broker flags are missing');

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const server = config.mcpServers['rux-permission'];
  const mcp = spawn(server.command, server.args, {
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 1;
  const pending = new Map();
  const stderr = [];
  mcp.stderr.setEncoding('utf8');
  mcp.stderr.on('data', (chunk) => stderr.push(chunk));
  const lines = createInterface({ input: mcp.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const rpc = (method, params) => {
    const id = nextId++;
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fake-claude', version: '1.0.0' },
  });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n');
  const listed = await rpc('tools/list', {});
  if (!listed.tools.some((tool) => tool.name === 'request_permission')) {
    throw new Error('permission tool was not listed');
  }
  const result = await rpc('tools/call', {
    name: 'request_permission',
    arguments: {
      tool_name: 'Bash',
      input: { command: 'touch approved.txt', description: 'Create an approval fixture' },
    },
  });
  const decision = JSON.parse(result.content[0].text);
  writeFileSync(process.env.RUX_FAKE_RESULT_PATH, JSON.stringify({ decision, permissionTool }));
  mcp.kill('SIGTERM');
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
`, "utf8");
  chmodSync(executable, 0o755);
  return executable;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error("Timed out waiting for condition");
}

for (const scenario of [
  {
    name: "allow",
    decision: { behavior: "allow" },
    expected: {
      behavior: "allow",
      updatedInput: { command: "touch approved.txt", description: "Create an approval fixture" },
    },
  },
  {
    name: "deny",
    decision: { behavior: "deny", message: "用户拒绝运行此命令" },
    expected: { behavior: "deny", message: "用户拒绝运行此命令" },
  },
]) {
  test(`Claude MCP permission broker blocks and returns official ${scenario.name} shape`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), `rux-claude-permission-${scenario.name}-`));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const executable = fakeClaude(directory);
    const argsPath = join(directory, "args.json");
    const resultPath = join(directory, "result.json");
    const oldArgsPath = process.env.RUX_FAKE_ARGS_PATH;
    const oldResultPath = process.env.RUX_FAKE_RESULT_PATH;
    process.env.RUX_FAKE_ARGS_PATH = argsPath;
    process.env.RUX_FAKE_RESULT_PATH = resultPath;
    t.after(() => {
      if (oldArgsPath === undefined) delete process.env.RUX_FAKE_ARGS_PATH;
      else process.env.RUX_FAKE_ARGS_PATH = oldArgsPath;
      if (oldResultPath === undefined) delete process.env.RUX_FAKE_RESULT_PATH;
      else process.env.RUX_FAKE_RESULT_PATH = oldResultPath;
    });

    const permission = deferred();
    const requestSeen = deferred();
    const events = [];
    let adapter;
    t.after(() => adapter?.dispose());
    const completed = new Promise((resolve, reject) => {
      adapter = new ClaudeCodeAdapter(directory, (event) => {
        events.push(event);
        if (event.type === "run.completed") resolve();
        if (event.type === "run.failed") reject(new Error(event.error));
      }, {
        executable,
        onPermissionRequest: (request) => {
          requestSeen.resolve(request);
          return permission.promise;
        },
        permissionRequestTimeoutMs: 5_000,
      });
      adapter.start({
        runId: `run-${scenario.name}`,
        prompt: "exercise provider permission callback",
        permissionMode: "acceptEdits",
      });
    });

    const request = await requestSeen.promise;
    assert.deepEqual(request, {
      requestId: request.requestId,
      runId: `run-${scenario.name}`,
      toolName: "Bash",
      input: { command: "touch approved.txt", description: "Create an approval fixture" },
    });
    assert.match(request.requestId, /^[0-9a-f-]{36}$/i);

    const invocation = JSON.parse(readFileSync(argsPath, "utf8"));
    assert.equal(invocation.permissionTool, "mcp__rux-permission__request_permission");
    assert.ok(invocation.args.includes("--permission-prompt-tool"));
    assert.ok(invocation.args.includes("--mcp-config"));
    assert.ok(existsSync(invocation.configPath));
    if (process.platform !== "win32") {
      assert.equal(statSync(invocation.configPath).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(invocation.configPath)).mode & 0o777, 0o700);
    }

    await delay(100);
    assert.equal(existsSync(resultPath), false, "fake Claude must remain blocked before host decision");
    permission.resolve(scenario.decision);
    await completed;
    const relayed = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.deepEqual(relayed, {
      decision: scenario.expected,
      permissionTool: "mcp__rux-permission__request_permission",
    });
    await waitUntil(() => !existsSync(invocation.configPath));
    adapter.dispose();
    assert.equal(events.filter((event) => event.type === "run.completed").length, 1);
  });
}

test("cancelling a waiting Claude run aborts the host callback and removes broker files", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-claude-permission-cancel-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = fakeClaude(directory);
  const argsPath = join(directory, "args.json");
  const resultPath = join(directory, "result.json");
  const oldArgsPath = process.env.RUX_FAKE_ARGS_PATH;
  const oldResultPath = process.env.RUX_FAKE_RESULT_PATH;
  process.env.RUX_FAKE_ARGS_PATH = argsPath;
  process.env.RUX_FAKE_RESULT_PATH = resultPath;
  t.after(() => {
    if (oldArgsPath === undefined) delete process.env.RUX_FAKE_ARGS_PATH;
    else process.env.RUX_FAKE_ARGS_PATH = oldArgsPath;
    if (oldResultPath === undefined) delete process.env.RUX_FAKE_RESULT_PATH;
    else process.env.RUX_FAKE_RESULT_PATH = oldResultPath;
  });

  const requestSeen = deferred();
  const aborted = deferred();
  const cancelled = deferred();
  const adapter = new ClaudeCodeAdapter(directory, (event) => {
    if (event.type === "run.cancelled") cancelled.resolve();
    if (event.type === "run.failed") cancelled.reject(new Error(event.error));
  }, {
    executable,
    onPermissionRequest: (request, signal) => {
      requestSeen.resolve(request);
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted.resolve();
          resolve({ behavior: "deny", message: "cancelled" });
        }, { once: true });
      });
    },
    permissionRequestTimeoutMs: 5_000,
  });
  t.after(() => adapter.dispose());
  adapter.start({
    runId: "run-cancel",
    prompt: "wait for a permission decision",
    permissionMode: "acceptEdits",
  });
  await requestSeen.promise;
  const invocation = JSON.parse(readFileSync(argsPath, "utf8"));
  adapter.cancel("run-cancel");
  await aborted.promise;
  await cancelled.promise;
  await waitUntil(() => !existsSync(invocation.configPath));
  assert.equal(existsSync(resultPath), false);
  adapter.dispose();
});
