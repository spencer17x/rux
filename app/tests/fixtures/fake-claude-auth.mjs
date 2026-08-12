#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2).join(" ");
const tracePath = process.env.RUX_FAKE_CLAUDE_TRACE;
if (tracePath) appendFileSync(tracePath, `claude ${args}\n`);

if (args === "--version") {
  process.stdout.write("2.1.0 (Claude Code)\n");
  process.exit(0);
}

if (args === "auth status --json") {
  const method = process.env.RUX_FAKE_CLAUDE_AUTH_METHOD ?? "signed-out";
  if (method === "signed-out") {
    process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({
    loggedIn: true,
    authMethod: method === "api-key" ? "api_key" : "oauth_token",
    apiProvider: method === "cloud" ? "awsBedrock" : "firstParty",
    account: { email: "fixture-private@example.invalid" },
    accessToken: "sk-ant-fixture-must-not-leak-123456",
  })}\n`);
  process.exit(0);
}

if (args === "auth login") process.exit(0);

process.stderr.write(`unsupported fake Claude command: ${args}\n`);
process.exit(2);
