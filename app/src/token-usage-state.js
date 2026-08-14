export function mergeTokenUsage(current, incoming) {
  if (!current || incoming.aggregation === "cumulative") {
    return { ...incoming, aggregation: "cumulative" };
  }
  const sum = (field) => current[field] === undefined && incoming[field] === undefined
    ? undefined
    : (current[field] || 0) + (incoming[field] || 0);
  return {
    ...incoming,
    aggregation: "cumulative",
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningOutputTokens: sum("reasoningOutputTokens"),
    totalTokens: sum("totalTokens"),
  };
}

export function tokenUsageTotal(usage) {
  if (!usage) return undefined;
  return usage.totalTokens ?? (usage.inputTokens !== undefined && usage.outputTokens !== undefined
    ? usage.inputTokens + usage.outputTokens
    : undefined);
}
