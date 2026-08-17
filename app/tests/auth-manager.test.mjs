import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AuthManager,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
} from "../src/electron/auth-manager.ts";

test("parses Claude Code OAuth status without exposing account payload", () => {
  const result = parseClaudeAuthStatus(JSON.stringify({
    loggedIn: true,
    authMethod: "oauth_token",
    apiProvider: "firstParty",
    email: "private@example.com",
  }), 0);

  assert.deepEqual(result, {
    status: "connected",
    authMethod: "oauth",
    detail: "Claude Code 已通过官方 CLI 连接",
  });
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
});

test("parses Claude Code signed-out status", () => {
  assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":false}', 1), {
    status: "signed-out",
    detail: "Claude Code CLI 已安装但尚未连接",
  });
});

test("parses ChatGPT and API-key Codex login states", () => {
  assert.deepEqual(parseCodexAuthStatus("Logged in using ChatGPT", 0), {
    status: "connected",
    authMethod: "chatgpt",
    detail: "Codex 已通过 ChatGPT 连接",
  });
  assert.deepEqual(parseCodexAuthStatus("Logged in using an API key", 0), {
    status: "connected",
    authMethod: "api-key",
    detail: "Codex 已通过官方 CLI 的 API Key 配置连接",
  });
  assert.equal(parseCodexAuthStatus("Not logged in", 1).status, "signed-out");
});

test("normalizes Claude Code cloud Provider status without exposing its payload", () => {
  const result = parseClaudeAuthStatus(JSON.stringify({
    loggedIn: true,
    authMethod: "api_key",
    apiProvider: "awsBedrock",
    accessToken: "sk-ant-this-must-not-leak",
    account: { email: "private@example.com" },
  }), 0);

  assert.deepEqual(result, {
    status: "connected",
    authMethod: "cloud",
    detail: "Claude Code 已通过官方 CLI 连接",
  });
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
  assert.equal(JSON.stringify(result).includes("sk-ant-"), false);
});

test("keeps explicit compatibility status inspection for both fake CLIs", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-status-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const fakeClaude = join(temporaryRoot, "claude");
  const previousOverride = process.env.CODEX_CLI_PATH;
  const previousClaudeOverride = process.env.CLAUDE_CODE_PATH;

  await writeFile(fakeCodex, `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("codex-cli 9.9.9");
else if (args === "login status") console.log("Logged in using ChatGPT");
else process.exit(2);
`, "utf8");
  await writeFile(fakeClaude, `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("1.2.3 (Claude Code)");
else if (args === "auth status --json") console.log(JSON.stringify({ loggedIn: false }));
else process.exit(2);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  await chmod(fakeClaude, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;
  process.env.CLAUDE_CODE_PATH = fakeClaude;

  try {
    const state = new AuthManager(temporaryRoot).status();
    assert.equal(state.providers.length, 2);
    const codex = state.providers.find((item) => item.id === "chatgpt");
    const claude = state.providers.find((item) => item.id === "claude-code");
    assert.equal(codex?.status, "connected");
    assert.equal(codex?.providerConnection?.id, "cli:codex:default");
    assert.equal(codex?.providerConnection?.engine, "codex");
    assert.equal(claude?.status, "signed-out");
    assert.equal(claude?.providerConnection?.id, "cli:claude-code:default");
    assert.equal(claude?.providerConnection?.engine, "claude-code");
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    if (previousClaudeOverride === undefined) delete process.env.CLAUDE_CODE_PATH;
    else process.env.CLAUDE_CODE_PATH = previousClaudeOverride;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("re-detects CLIs installed after an initial not-installed result", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-redetect-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const fakeClaude = join(temporaryRoot, "claude");
  const previousOverride = process.env.CODEX_CLI_PATH;
  const previousClaudeOverride = process.env.CLAUDE_CODE_PATH;
  process.env.CODEX_CLI_PATH = fakeCodex;
  process.env.CLAUDE_CODE_PATH = fakeClaude;

  try {
    const manager = new AuthManager(temporaryRoot);
    const missing = manager.status();
    assert.deepEqual(missing.providers.map((provider) => provider.status), ["not-installed", "not-installed"]);

    await writeFile(fakeCodex, `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("codex-cli 9.9.9");
else if (args === "login status") console.log("Logged in using an API key");
else process.exit(2);
`, "utf8");
    await writeFile(fakeClaude, `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("1.2.3 (Claude Code)");
else if (args === "auth status --json") { console.log(JSON.stringify({ loggedIn: false })); process.exit(1); }
else process.exit(2);
`, "utf8");
    await chmod(fakeCodex, 0o755);
    await chmod(fakeClaude, 0o755);

    const detected = manager.status();
    assert.equal(detected.providers.find((provider) => provider.id === "chatgpt")?.authMethod, "api-key");
    assert.equal(detected.providers.find((provider) => provider.id === "claude-code")?.status, "signed-out");
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    if (previousClaudeOverride === undefined) delete process.env.CLAUDE_CODE_PATH;
    else process.env.CLAUDE_CODE_PATH = previousClaudeOverride;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("delegates an explicit Codex login to only the official codex login command", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-test-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const fakeClaude = join(temporaryRoot, "claude");
  const tracePath = join(temporaryRoot, "commands.log");
  const previousOverride = process.env.CODEX_CLI_PATH;
  const previousClaudeOverride = process.env.CLAUDE_CODE_PATH;
  const previousTrace = process.env.RUX_AUTH_TEST_TRACE;

  await writeFile(fakeCodex, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.RUX_AUTH_TEST_TRACE, \`codex \${args.join(" ")}\\n\`);
if (args.length === 1 && args[0] === "login") process.exit(0);
else process.exit(2);
`, "utf8");
  await writeFile(fakeClaude, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.RUX_AUTH_TEST_TRACE, \`claude \${process.argv.slice(2).join(" ")}\\n\`);
process.exit(91);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  await chmod(fakeClaude, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;
  process.env.CLAUDE_CODE_PATH = fakeClaude;
  process.env.RUX_AUTH_TEST_TRACE = tracePath;

  try {
    const state = await new AuthManager(temporaryRoot).login("chatgpt");
    assert.equal(state.providers.length, 1);
    const provider = state.providers[0];
    assert.equal(provider?.id, "chatgpt");
    assert.equal(provider?.status, "connected");
    assert.equal(provider?.authMethod, "chatgpt");
    assert.equal(provider?.detail, "已通过官方 codex CLI 完成 ChatGPT 登录");
    assert.equal(provider?.providerConnection?.id, "cli:codex:default");
    assert.equal(await readFile(tracePath, "utf8"), "codex login\n");
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    if (previousClaudeOverride === undefined) delete process.env.CLAUDE_CODE_PATH;
    else process.env.CLAUDE_CODE_PATH = previousClaudeOverride;
    if (previousTrace === undefined) delete process.env.RUX_AUTH_TEST_TRACE;
    else process.env.RUX_AUTH_TEST_TRACE = previousTrace;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("delegates an explicit Claude login to only the official claude auth login command", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-claude-login-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const fakeClaude = join(temporaryRoot, "claude");
  const tracePath = join(temporaryRoot, "commands.log");
  const previousOverride = process.env.CODEX_CLI_PATH;
  const previousClaudeOverride = process.env.CLAUDE_CODE_PATH;
  const previousTrace = process.env.RUX_AUTH_TEST_TRACE;

  await writeFile(fakeCodex, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.RUX_AUTH_TEST_TRACE, \`codex \${process.argv.slice(2).join(" ")}\\n\`);
process.exit(91);
`, "utf8");
  await writeFile(fakeClaude, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.RUX_AUTH_TEST_TRACE, \`claude \${args.join(" ")}\\n\`);
if (args.join(" ") === "auth login") process.exit(0);
else process.exit(92);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  await chmod(fakeClaude, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;
  process.env.CLAUDE_CODE_PATH = fakeClaude;
  process.env.RUX_AUTH_TEST_TRACE = tracePath;

  try {
    const state = await new AuthManager(temporaryRoot).login("claude-code");
    assert.equal(state.providers.length, 1);
    const provider = state.providers[0];
    assert.equal(provider?.id, "claude-code");
    assert.equal(provider?.status, "connected");
    assert.equal(provider?.authMethod, "oauth");
    assert.equal(provider?.providerConnection?.id, "cli:claude-code:default");
    assert.equal(provider?.detail, "已通过官方 Claude Code CLI 完成登录");
    assert.equal(await readFile(tracePath, "utf8"), "claude auth login\n");
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    if (previousClaudeOverride === undefined) delete process.env.CLAUDE_CODE_PATH;
    else process.env.CLAUDE_CODE_PATH = previousClaudeOverride;
    if (previousTrace === undefined) delete process.env.RUX_AUTH_TEST_TRACE;
    else process.env.RUX_AUTH_TEST_TRACE = previousTrace;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("delegates explicit logout only to each official CLI and returns sanitized signed-out state", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-logout-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const fakeClaude = join(temporaryRoot, "claude");
  const tracePath = join(temporaryRoot, "commands.log");
  const previousOverride = process.env.CODEX_CLI_PATH;
  const previousClaudeOverride = process.env.CLAUDE_CODE_PATH;
  const previousTrace = process.env.RUX_AUTH_TEST_TRACE;
  await writeFile(fakeCodex, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.RUX_AUTH_TEST_TRACE, \`codex \${process.argv.slice(2).join(" ")}\\n\`);
process.exit(process.argv.slice(2).join(" ") === "logout" ? 0 : 90);
`, "utf8");
  await writeFile(fakeClaude, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.RUX_AUTH_TEST_TRACE, \`claude \${process.argv.slice(2).join(" ")}\\n\`);
process.exit(process.argv.slice(2).join(" ") === "auth logout" ? 0 : 91);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  await chmod(fakeClaude, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;
  process.env.CLAUDE_CODE_PATH = fakeClaude;
  process.env.RUX_AUTH_TEST_TRACE = tracePath;
  try {
    const manager = new AuthManager(temporaryRoot);
    const codex = await manager.logout("chatgpt");
    const claude = await manager.logout("claude-code");
    assert.equal(codex.providers[0].status, "signed-out");
    assert.equal(codex.providers[0].authMethod, undefined);
    assert.equal(claude.providers[0].status, "signed-out");
    assert.equal(await readFile(tracePath, "utf8"), "codex logout\nclaude auth logout\n");
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    if (previousClaudeOverride === undefined) delete process.env.CLAUDE_CODE_PATH;
    else process.env.CLAUDE_CODE_PATH = previousClaudeOverride;
    if (previousTrace === undefined) delete process.env.RUX_AUTH_TEST_TRACE;
    else process.env.RUX_AUTH_TEST_TRACE = previousTrace;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reports official logout failure without running a status or another Engine", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-logout-failure-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const previousOverride = process.env.CODEX_CLI_PATH;
  await writeFile(fakeCodex, `#!/usr/bin/env node
process.exit(process.argv.slice(2).join(" ") === "logout" ? 7 : 92);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;
  try {
    await assert.rejects(new AuthManager(temporaryRoot).logout("chatgpt"), /退出登录失败（官方 CLI 退出码 7）/);
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reports a non-zero official Codex CLI exit without checking status", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-failure-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const previousOverride = process.env.CODEX_CLI_PATH;

  await writeFile(fakeCodex, `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "login") process.exit(7);
process.exit(92);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;

  try {
    await assert.rejects(
      new AuthManager(temporaryRoot).login("chatgpt"),
      /Rux 登录未完成（官方 CLI 退出码 7）/,
    );
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("times out and stops an explicit Codex login", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-timeout-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const previousOverride = process.env.CODEX_CLI_PATH;

  await writeFile(fakeCodex, `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "login") setInterval(() => {}, 1000);
else process.exit(2);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;

  try {
    const manager = new AuthManager(temporaryRoot, { loginTimeoutMs: 40 });
    await assert.rejects(manager.login("chatgpt"), /Rux 登录等待超时；本次官方 CLI 登录已停止/);
    await manager.dispose();
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("cancels an in-flight Codex login process group", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rux-auth-cancel-"));
  const fakeCodex = join(temporaryRoot, "codex");
  const previousOverride = process.env.CODEX_CLI_PATH;

  await writeFile(fakeCodex, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("codex-cli 9.9.9");
else if (args[0] === "login" && args[1] === "status") { console.log("Not logged in"); process.exit(1); }
else if (args[0] === "login") setInterval(() => {}, 1000);
else process.exit(2);
`, "utf8");
  await chmod(fakeCodex, 0o755);
  process.env.CODEX_CLI_PATH = fakeCodex;

  try {
    const manager = new AuthManager(temporaryRoot);
    const login = assert.rejects(manager.login("chatgpt"), /Rux 登录已取消/);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await manager.cancel("chatgpt");
    await login;
    await manager.dispose();
  } finally {
    if (previousOverride === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousOverride;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
