import assert from "node:assert/strict";
import test from "node:test";
import { computeLocalSuccessMetrics } from "../src/local-success-metrics.js";

test("local success metrics derive only explainable persisted Task and Run facts", () => {
  const metrics = computeLocalSuccessMetrics([
    { id: "starter", runs: [] },
    { id: "one", runs: [
      { adapter: "codex", status: "completed", durationMs: 1_000, permissionDecisions: [{ decision: "approved" }] },
      { adapter: "codex", status: "failed", durationMs: 2_000, permissionDecisions: [{ decision: "denied" }] },
    ] },
    { id: "two", runs: [
      { adapter: "rux-native", status: "completed", durationMs: 3_000, permissionDecisions: [] },
      { adapter: "rux-native", status: "cancelled", permissionDecisions: [] },
      { adapter: "rux-native", status: "running", permissionDecisions: [] },
    ] },
  ]);
  assert.deepEqual(metrics, {
    taskCount: 2,
    successfulTaskCount: 2,
    runCount: 5,
    terminalRunCount: 4,
    completedRunCount: 2,
    failedRunCount: 1,
    stoppedRunCount: 1,
    completionRate: 50,
    medianCompletedDurationMs: 2_000,
    permissionDecisionCount: 2,
    approvedPermissionCount: 1,
    adapters: { codex: 2, "rux-native": 3 },
  });
});

test("local success metrics keep missing evidence unknown instead of inventing zero success", () => {
  const metrics = computeLocalSuccessMetrics([{ id: "empty", runs: [] }]);
  assert.equal(metrics.completionRate, undefined);
  assert.equal(metrics.medianCompletedDurationMs, undefined);
  assert.equal(metrics.runCount, 0);
});
