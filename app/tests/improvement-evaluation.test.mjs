import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gradeImprovementEvaluation, runIsolatedImprovementEvaluation } from "../src/electron/improvement-evaluation.ts";
import { builtInAgentRevisionId } from "../src/shared/protocol.ts";

const cases = [{ id: "representative", holdout: false }, { id: "holdout", holdout: true }];
const outcome = (caseId, variant, passed) => ({ caseId, variant, passed, outputPreview: "", durationMs: 1 });

test("isolated A/B grader requires every candidate and holdout case without baseline regression", () => {
  assert.deepEqual(gradeImprovementEvaluation(cases, [outcome("representative", "baseline", false), outcome("representative", "candidate", true), outcome("holdout", "baseline", true), outcome("holdout", "candidate", true)]), { status: "passed", baselinePassed: 1, candidatePassed: 2, holdoutPassed: true });
  assert.equal(gradeImprovementEvaluation(cases, [outcome("representative", "baseline", true), outcome("representative", "candidate", true), outcome("holdout", "baseline", true), outcome("holdout", "candidate", false)]).status, "failed");
});

test("Codex evaluator uses ephemeral tool-free Threads for baseline, candidate, and holdout", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-improvement-eval-"));
  const executable = join(directory, "codex");
  const transcript = join(directory, "transcript.jsonl");
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-codex-app-server.mjs"), executable);
  chmodSync(executable, 0o755);
  writeFileSync(transcript, "", "utf8");
  const previous = { executable: process.env.CODEX_CLI_PATH, scenario: process.env.RUX_FAKE_CODEX_SCENARIO, transcript: process.env.RUX_FAKE_CODEX_TRANSCRIPT };
  process.env.CODEX_CLI_PATH = executable;
  process.env.RUX_FAKE_CODEX_SCENARIO = "runtime-echo";
  process.env.RUX_FAKE_CODEX_TRANSCRIPT = transcript;
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    for (const [name, value] of Object.entries({ CODEX_CLI_PATH: previous.executable, RUX_FAKE_CODEX_SCENARIO: previous.scenario, RUX_FAKE_CODEX_TRANSCRIPT: previous.transcript })) value === undefined ? delete process.env[name] : process.env[name] = value;
  });
  const result = await runIsolatedImprovementEvaluation(directory, {
    operationId: "evaluation-test", candidateId: "candidate-1", projectId: "project-1", candidateContent: "Prefer focused verification.", adapter: "codex", evaluatorAgentId: "codex", evaluatorAgentRevisionId: builtInAgentRevisionId("codex"),
    cases: [{ id: "representative", name: "Representative", input: "Respond", expectedIncludes: "Generated summary", holdout: false }, { id: "holdout", name: "Holdout", input: "Respond again", expectedIncludes: "Generated summary", holdout: true }],
  });
  assert.equal(result.status, "passed");
  assert.equal(result.outcomes.length, 4);
  const messages = readFileSync(transcript, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const threadStarts = messages.filter((entry) => entry.direction === "client" && entry.message.method === "thread/start");
  assert.equal(threadStarts.length, 4);
  assert.equal(threadStarts.every((entry) => entry.message.params.ephemeral === true), true);
});

test("isolated evaluator rejects fabricated custom Revisions before launching", async () => {
  await assert.rejects(runIsolatedImprovementEvaluation(process.cwd(), { operationId: "invalid", candidateId: "candidate", projectId: "project", candidateContent: "content", adapter: "codex", evaluatorAgentId: "custom", evaluatorAgentRevisionId: "missing-revision", profileId: "missing-profile", cases: [{ id: "holdout", name: "Holdout", input: "input", expectedIncludes: "output", holdout: true }] }), /Revision is unavailable/);
});
