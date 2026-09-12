/** Provider-independent, per-turn accounting. Cache and reasoning are subsets. */
export type TokenUsage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningOutputTokens?: number;
};

export type TurnInfo = {
  recordId?: string;
  agentId?: string;
  model?: string;
  modelLabel?: string;
  reasoning?: string;
  mode?: string;
  nativeTurnId?: string;
  nativeMessageIds?: string[];
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  usage?: TokenUsage;
};

const usageKeys = ["totalTokens", "inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningOutputTokens"] as const;
export const nonnegativeNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

export function tokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const result: TokenUsage = {};
  for (const key of usageKeys) {
    const count = nonnegativeNumber(input[key]);
    if (count !== undefined && Number.isSafeInteger(count)) result[key] = count;
  }
  if (result.totalTokens === undefined && result.inputTokens !== undefined && result.outputTokens !== undefined) result.totalTokens = result.inputTokens + result.outputTokens;
  return Object.keys(result).length ? result : undefined;
}

export function sumUsage(values: Array<TokenUsage | undefined>): TokenUsage | undefined {
  const known = values.filter((value): value is TokenUsage => Boolean(value));
  if (!known.length) return undefined;
  const result: TokenUsage = {};
  for (const key of usageKeys) {
    const counts = known.map((value) => value[key]).filter((count): count is number => count !== undefined);
    if (counts.length) result[key] = counts.reduce((sum, count) => sum + count, 0);
  }
  return tokenUsage(result);
}

export function subtractUsage(total: TokenUsage, previous: TokenUsage): TokenUsage {
  return Object.fromEntries(usageKeys.flatMap((key) => total[key] !== undefined ? [[key, Math.max(0, total[key]! - (previous[key] ?? 0))]] : []));
}

/** Responses and Codex include cached input and reasoning output in their totals. */
export function responsesUsage(value: any): TokenUsage | undefined {
  if (!value) return undefined;
  return tokenUsage({ totalTokens: value.total_tokens, inputTokens: value.input_tokens, outputTokens: value.output_tokens, cachedInputTokens: value.input_tokens_details?.cached_tokens, reasoningOutputTokens: value.output_tokens_details?.reasoning_tokens });
}

/** Anthropic reports non-cached input separately from cache reads/writes. */
export function claudeUsage(value: any): TokenUsage | undefined {
  if (!value) return undefined;
  const raw = nonnegativeNumber(value.inputTokens ?? value.input_tokens);
  const output = nonnegativeNumber(value.outputTokens ?? value.output_tokens);
  const cached = nonnegativeNumber(value.cacheReadInputTokens ?? value.cache_read_input_tokens);
  const written = nonnegativeNumber(value.cacheCreationInputTokens ?? value.cache_creation_input_tokens);
  return tokenUsage({ inputTokens: raw === undefined ? undefined : raw + (cached ?? 0) + (written ?? 0), outputTokens: output, cachedInputTokens: cached, cacheWriteInputTokens: written });
}

export function piUsage(value: any): TokenUsage | undefined {
  if (!value) return undefined;
  const input = nonnegativeNumber(value.input);
  const cached = nonnegativeNumber(value.cacheRead);
  const written = nonnegativeNumber(value.cacheWrite);
  return tokenUsage({ totalTokens: value.totalTokens ?? value.total, inputTokens: input === undefined ? undefined : input + (cached ?? 0) + (written ?? 0), outputTokens: value.output, cachedInputTokens: cached, cacheWriteInputTokens: written });
}

/** Persist only explicitly allowed telemetry, never arbitrary provider payloads. */
export function sanitizeTurnInfo(value: unknown): TurnInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const result: TurnInfo = {};
  for (const key of ["recordId", "agentId", "model", "modelLabel", "reasoning", "mode", "nativeTurnId"] as const) {
    if (typeof input[key] === "string" && input[key]) result[key] = input[key].slice(0, 300);
  }
  for (const key of ["startedAt", "completedAt", "elapsedMs"] as const) {
    const value = nonnegativeNumber(input[key]);
    if (value !== undefined) result[key] = value;
  }
  if (Array.isArray(input.nativeMessageIds)) result.nativeMessageIds = [...new Set(input.nativeMessageIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 300))].slice(0, 500);
  const usage = tokenUsage(input.usage);
  if (usage) result.usage = usage;
  return Object.keys(result).length ? result : undefined;
}

export function mergeTurnInfo(current: TurnInfo | undefined, update: TurnInfo | undefined): TurnInfo | undefined {
  update = sanitizeTurnInfo(update);
  if (!update) return current;
  return { ...current, ...(update.model && update.model !== current?.model ? { modelLabel: undefined } : {}), ...update, ...(current?.nativeMessageIds || update.nativeMessageIds ? { nativeMessageIds: [...new Set([...(current?.nativeMessageIds || []), ...(update.nativeMessageIds || [])])].slice(0, 500) } : {}) };
}

export function turnInfoMatches(saved: TurnInfo, native: TurnInfo | undefined): boolean {
  if (!native) return false;
  if (saved.nativeTurnId && saved.nativeTurnId === native.nativeTurnId) return true;
  return Boolean(saved.nativeMessageIds?.some((id) => native.nativeMessageIds?.includes(id)));
}
