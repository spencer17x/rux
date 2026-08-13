import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateIsolatedHandoffSummary } from "../src/electron/handoff-summary.ts";
import { builtInAgentRevisionId, defaultProviderConnectionForAdapter } from "../src/shared/protocol.ts";

const fixtureSource = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-codex-app-server.mjs");

test("generates a source-Agent summary in an ephemeral Codex Thread without Runtime events", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-handoff-summary-"));
  const executable = join(directory, "codex");
  const transcript = join(directory, "transcript.jsonl");
  copyFileSync(fixtureSource, executable);
  chmodSync(executable, 0o755);
  writeFileSync(transcript, "", "utf8");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const previous = {
    executable: process.env.CODEX_CLI_PATH,
    scenario: process.env.RUX_FAKE_CODEX_SCENARIO,
    transcript: process.env.RUX_FAKE_CODEX_TRANSCRIPT,
  };
  process.env.CODEX_CLI_PATH = executable;
  process.env.RUX_FAKE_CODEX_SCENARIO = "runtime-echo";
  process.env.RUX_FAKE_CODEX_TRANSCRIPT = transcript;
  t.after(() => {
    for (const [name, value] of Object.entries({
      CODEX_CLI_PATH: previous.executable,
      RUX_FAKE_CODEX_SCENARIO: previous.scenario,
      RUX_FAKE_CODEX_TRANSCRIPT: previous.transcript,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const revisionId = builtInAgentRevisionId("codex");
  const result = await generateIsolatedHandoffSummary(directory, {
    operationId: "handoff-summary-test",
    adapter: "codex",
    prompt: "Generate an optional narrative Context Handoff summary from deterministic facts.",
    agentRevisionId: revisionId,
    providerConnection: defaultProviderConnectionForAdapter("codex"),
  }, () => undefined);

  assert.equal(result.summary, "Generated summary from deterministic facts.");
  assert.deepEqual(result.provenance, {
    sourceAgentRevisionId: revisionId,
    sourceAdapter: "codex",
    generatedAt: result.provenance.generatedAt,
    isolated: true,
    nativeSessionPersisted: false,
  });
  const messages = readFileSync(transcript, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const clientMessages = messages.filter((entry) => entry.direction === "client").map((entry) => entry.message);
  const threadStart = clientMessages.find((message) => message.method === "thread/start");
  assert.equal(threadStart.params.ephemeral, true);
  assert.equal(clientMessages.some((message) => message.method === "thread/resume"), false);
});

test("rejects a fabricated custom source Revision before launching an Engine", async () => {
  await assert.rejects(
    generateIsolatedHandoffSummary(process.cwd(), {
      operationId: "handoff-summary-invalid-revision",
      adapter: "claude-code",
      prompt: "Summarize facts",
      profileId: "missing-profile",
      agentRevisionId: "agent-revision-missing",
      providerConnection: defaultProviderConnectionForAdapter("claude-code"),
    }, () => undefined),
    /Revision is unavailable/,
  );
});
