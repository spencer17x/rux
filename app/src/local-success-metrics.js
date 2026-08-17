const terminalRunStatuses = new Set(["completed", "failed", "cancelled", "interrupted"]);

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function computeLocalSuccessMetrics(tasks = []) {
  const runs = tasks.flatMap((task) => Array.isArray(task.runs) ? task.runs : []);
  const terminalRuns = runs.filter((run) => terminalRunStatuses.has(run.status));
  const completedRuns = terminalRuns.filter((run) => run.status === "completed");
  const failedRuns = terminalRuns.filter((run) => run.status === "failed");
  const stoppedRuns = terminalRuns.filter((run) => ["cancelled", "interrupted"].includes(run.status));
  const completedDurations = completedRuns.map((run) => run.durationMs).filter((value) => Number.isFinite(value) && value >= 0);
  const tasksWithRuns = tasks.filter((task) => Array.isArray(task.runs) && task.runs.length > 0);
  const tasksWithCompletedRun = tasksWithRuns.filter((task) => task.runs.some((run) => run.status === "completed"));
  const permissionDecisions = runs.flatMap((run) => Array.isArray(run.permissionDecisions) ? run.permissionDecisions : []);
  const adapters = Object.fromEntries([...new Set(runs.map((run) => run.adapter).filter(Boolean))].sort().map((adapter) => [adapter, runs.filter((run) => run.adapter === adapter).length]));
  return {
    taskCount: tasksWithRuns.length,
    successfulTaskCount: tasksWithCompletedRun.length,
    runCount: runs.length,
    terminalRunCount: terminalRuns.length,
    completedRunCount: completedRuns.length,
    failedRunCount: failedRuns.length,
    stoppedRunCount: stoppedRuns.length,
    completionRate: terminalRuns.length ? Math.round((completedRuns.length / terminalRuns.length) * 100) : undefined,
    medianCompletedDurationMs: median(completedDurations),
    permissionDecisionCount: permissionDecisions.length,
    approvedPermissionCount: permissionDecisions.filter((decision) => decision.decision === "approved").length,
    adapters,
  };
}
