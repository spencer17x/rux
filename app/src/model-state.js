function normalizedModel(model) {
  return String(model || "").trim();
}

export function classifyModelFailure(error) {
  const value = String(error || "").toLocaleLowerCase();
  if (!value) return "unknown";
  if (/(model[_ -]not[_ -]found|unsupported[_ -]model|invalid[_ -]model|unknown model|model[^\n]{0,100}(does not exist|not found|not supported|unsupported|incompatible))/.test(value)) {
    return "unavailable";
  }
  if (/(unauthori[sz]ed|forbidden|authentication|api key|quota|rate.?limit|too many requests|timeout|timed out|network|connection|temporar|service unavailable|overloaded|429|502|503|504)/.test(value)) {
    return "retryable";
  }
  return "unknown";
}

export function modelSelectionState(adapter, model, catalogModels = [], verifiedModels = []) {
  const value = normalizedModel(model);
  if (!value || /\bdefault\b/i.test(value)) {
    return { modelSource: "engine-default", modelVerificationStatus: "not-required" };
  }
  if (catalogModels.some((item) => item.model === value || item.id === value)) {
    return { modelSource: "engine-catalog", modelVerificationStatus: "not-required" };
  }
  if (verifiedModels.some((item) => (typeof item === "string" ? item : item.model) === value)) {
    return { modelSource: "verified-history", modelVerificationStatus: "verified" };
  }
  return { modelSource: "manual", modelVerificationStatus: "unverified" };
}

export function modelStateAfterRun(run, event) {
  const current = {
    modelSource: run.modelSource || "manual",
    modelVerificationStatus: run.modelVerificationStatus || "unverified",
  };
  if (event?.type === "run.completed" && run.status === "completed") {
    if (["manual", "verified-history"].includes(current.modelSource)) {
      return { ...current, modelVerificationStatus: "verified" };
    }
    return current;
  }
  if (event?.type === "run.failed" && classifyModelFailure(event.error) === "unavailable") {
    return { ...current, modelVerificationStatus: "unavailable" };
  }
  return current;
}

export function reconcileEngineDefaultModelDecision(decision, reportedModel) {
  const model = normalizedModel(reportedModel);
  if (
    !decision
    || !model
    || decision.mode !== "fixed"
    || decision.modelSource !== "engine-default"
    || decision.actualModel !== "engine-default"
  ) {
    return decision;
  }
  return { ...decision, actualModel: model };
}

export function verifiedModelHistory(tasks, adapter, connectionId) {
  const latest = new Map();
  for (const task of tasks || []) {
    for (const run of task.runs || []) {
      if (run.adapter !== adapter || run.providerConnection?.id !== connectionId) continue;
      if (!run.model || run.modelVerificationStatus !== "verified") continue;
      const verifiedAt = run.finishedAt || run.updatedAt || task.updatedAtIso || task.createdAt || "";
      const existing = latest.get(run.model);
      if (!existing || verifiedAt > existing.verifiedAt) {
        latest.set(run.model, { model: run.model, verifiedAt });
      }
    }
  }
  return [...latest.values()].sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
}

export function catalogModelMissing(task, catalog) {
  return Boolean(
    task?.model
    && task.modelSource === "engine-catalog"
    && catalog?.refreshedAt
    && !(catalog.models || []).some((item) => item.model === task.model || item.id === task.model),
  );
}
