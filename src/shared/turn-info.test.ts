import { describe, expect, it } from "vitest";
import { claudeUsage, mergeTurnInfo, piUsage, responsesUsage, sanitizeTurnInfo, subtractUsage, sumUsage, tokenUsage, turnInfoMatches } from "./turn-info";

describe("per-turn usage normalization", () => {
  it("does not count cached input or reasoning output twice", () => {
    expect(responsesUsage({ input_tokens: 9860, output_tokens: 2620, total_tokens: 12480, input_tokens_details: { cached_tokens: 6144 }, output_tokens_details: { reasoning_tokens: 1820 } })).toEqual({ inputTokens: 9860, outputTokens: 2620, totalTokens: 12480, cachedInputTokens: 6144, reasoningOutputTokens: 1820 });
    expect(claudeUsage({ inputTokens: 100, cacheReadInputTokens: 200, cacheCreationInputTokens: 50, outputTokens: 30 })).toMatchObject({ inputTokens: 350, outputTokens: 30, totalTokens: 380 });
    expect(piUsage({ input: 100, cacheRead: 200, cacheWrite: 50, output: 30, total: 380 })).toMatchObject({ inputTokens: 350, totalTokens: 380 });
  });

  it("preserves reported zero and rejects unknown or invalid values", () => {
    expect(tokenUsage({ inputTokens: 0, outputTokens: 0 })).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(tokenUsage({ totalTokens: -1, inputTokens: NaN, outputTokens: "300" })).toBeUndefined();
    expect(sumUsage([])).toBeUndefined();
    expect(subtractUsage({ totalTokens: 1400 }, { totalTokens: 1000 })).toEqual({ totalTokens: 400 });
  });

  it("keeps only allowed telemetry and matches native turns by stable identity", () => {
    const value = sanitizeTurnInfo({ agentId: "codex", model: "gpt-6-astra", nativeTurnId: "turn", nativeMessageIds: ["a", "a", 123], apiKey: "must-not-persist", usage: { totalTokens: 123, rawResponse: "secret" } });
    expect(value).toEqual({ agentId: "codex", model: "gpt-6-astra", nativeTurnId: "turn", nativeMessageIds: ["a"], usage: { totalTokens: 123 } });
    expect(turnInfoMatches(value!, { nativeTurnId: "turn" })).toBe(true);
    expect(turnInfoMatches(value!, { nativeMessageIds: ["a"] })).toBe(true);
    expect(turnInfoMatches(value!, { nativeTurnId: "another", model: "gpt-6-astra" })).toBe(false);
  });

  it("drops a stale display alias when the runtime reports a different model", () => {
    const merged = mergeTurnInfo({ model: "default", modelLabel: "默认模型", nativeMessageIds: ["a"], usage: { totalTokens: 30 } }, { model: "gpt-6-astra", nativeMessageIds: ["b"], usage: undefined });
    expect(merged).toMatchObject({ model: "gpt-6-astra", nativeMessageIds: ["a", "b"], usage: { totalTokens: 30 } });
    expect(merged?.modelLabel).toBeUndefined();
  });
});
