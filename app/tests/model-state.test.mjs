import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogModelMissing,
  classifyModelFailure,
  modelSelectionState,
  modelStateAfterRun,
  reconcileEngineDefaultModelDecision,
  verifiedModelHistory,
} from "../src/model-state.js";

test("model selection distinguishes defaults, official catalog, verified history, and manual IDs", () => {
  const catalog = [{ id: "official-id", model: "official-model" }];
  const verified = [{ model: "private-model", verifiedAt: "2026-08-12T01:00:00.000Z" }];
  assert.deepEqual(modelSelectionState("claude-code", "Claude default"), { modelSource: "engine-default", modelVerificationStatus: "not-required" });
  assert.deepEqual(modelSelectionState("codex", "official-model", catalog), { modelSource: "engine-catalog", modelVerificationStatus: "not-required" });
  assert.deepEqual(modelSelectionState("claude-code", "private-model", [], verified), { modelSource: "verified-history", modelVerificationStatus: "verified" });
  assert.deepEqual(modelSelectionState("claude-code", "new-private-model"), { modelSource: "manual", modelVerificationStatus: "unverified" });
});

test("only a successful run verifies a manual model and explicit incompatibility makes it unavailable", () => {
  const manual = { status: "completed", modelSource: "manual", modelVerificationStatus: "unverified" };
  assert.deepEqual(modelStateAfterRun(manual, { type: "run.completed" }), { modelSource: "manual", modelVerificationStatus: "verified" });
  assert.deepEqual(modelStateAfterRun({ ...manual, status: "failed" }, { type: "run.failed", error: "model_not_found: private-x" }), { modelSource: "manual", modelVerificationStatus: "unavailable" });
  for (const error of ["401 unauthorized", "quota exceeded", "network timeout", "rate limit 429", "unexpected provider failure"]) {
    assert.deepEqual(modelStateAfterRun({ ...manual, status: "failed" }, { type: "run.failed", error }), { modelSource: "manual", modelVerificationStatus: "unverified" });
  }
  assert.equal(classifyModelFailure("This model is incompatible with the endpoint"), "unavailable");
});

test("verified history is isolated by Engine and Connection and keeps the latest timestamp", () => {
  const tasks = [{
    updatedAtIso: "2026-08-12T03:00:00.000Z",
    runs: [
      { adapter: "codex", providerConnection: { id: "connection-a" }, model: "private-x", modelVerificationStatus: "verified", finishedAt: "2026-08-12T01:00:00.000Z" },
      { adapter: "codex", providerConnection: { id: "connection-a" }, model: "private-x", modelVerificationStatus: "verified", finishedAt: "2026-08-12T02:00:00.000Z" },
      { adapter: "codex", providerConnection: { id: "connection-b" }, model: "private-y", modelVerificationStatus: "verified", finishedAt: "2026-08-12T03:00:00.000Z" },
      { adapter: "claude-code", providerConnection: { id: "connection-a" }, model: "private-z", modelVerificationStatus: "verified", finishedAt: "2026-08-12T04:00:00.000Z" },
    ],
  }];
  assert.deepEqual(verifiedModelHistory(tasks, "codex", "connection-a"), [{ model: "private-x", verifiedAt: "2026-08-12T02:00:00.000Z" }]);
});

test("catalog removal warns only after a refresh and never substitutes the task model", () => {
  const task = { model: "retired-model", modelSource: "engine-catalog" };
  assert.equal(catalogModelMissing(task, { models: [], refreshedAt: "" }), false);
  assert.equal(catalogModelMissing(task, { models: [], refreshedAt: "2026-08-12T01:00:00.000Z" }), true);
  assert.equal(catalogModelMissing({ ...task, modelSource: "manual" }, { models: [], refreshedAt: "2026-08-12T01:00:00.000Z" }), false);
});

test("provider metadata resolves an Engine-default decision without changing explicit decisions", () => {
  const engineDefault = {
    mode: "fixed",
    modelSource: "engine-default",
    actualModel: "engine-default",
  };
  assert.deepEqual(reconcileEngineDefaultModelDecision(engineDefault, "gpt-5.6-sol"), {
    ...engineDefault,
    actualModel: "gpt-5.6-sol",
  });
  const explicit = { ...engineDefault, modelSource: "manual", actualModel: "gpt-5.6-sol" };
  assert.equal(reconcileEngineDefaultModelDecision(explicit, "gpt-5.6"), explicit);
  assert.equal(reconcileEngineDefaultModelDecision(engineDefault, ""), engineDefault);
});
