import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertNativeSessionModelCompatibility, classifyAutoModelPrompt, engineSupportsPerRunModelSelection, isExplicitModelIncompatibility, selectAutoModel } from "../src/auto-model-routing.ts";
import { AgentProfileStore } from "../src/electron/agent-profile-store.ts";
import { autoModelPolicySchema, runModelDecisionSchema, tokenUsageSchema } from "../src/shared/protocol.ts";
import { mergeTokenUsage, tokenUsageTotal } from "../src/token-usage-state.js";

const policy = {
  simpleModel: { model: "gpt-simple", source: "engine-catalog" },
  complexModel: { model: "gpt-complex", source: "verified-history" },
  strategy: "balanced",
  fallbackEnabled: true,
  allowlist: [
    { model: "gpt-simple", source: "engine-catalog" },
    { model: "gpt-complex", source: "verified-history" },
  ],
};

test("Auto policy accepts only catalog or verified candidates and pins both routed models to the allowlist", () => {
  assert.deepEqual(autoModelPolicySchema.parse(policy), policy);
  assert.throws(() => autoModelPolicySchema.parse({ ...policy, allowlist: [policy.simpleModel] }), /Complex model must be in the Auto allowlist/);
  assert.throws(() => autoModelPolicySchema.parse({
    ...policy,
    simpleModel: { model: "manual", source: "manual" },
  }), /Invalid option/);
});

test("deterministic router keeps short explanation simple and architecture implementation complex", () => {
  const simple = classifyAutoModelPrompt("解释这个函数是什么", "balanced");
  const complex = classifyAutoModelPrompt("设计数据库迁移与权限协议，修复并测试跨模块实现，然后完成发布验收。", "balanced");
  assert.equal(simple.classification, "simple");
  assert.equal(complex.classification, "complex");
  assert.equal(selectAutoModel(policy, "解释这个函数是什么").model, "gpt-simple");
  assert.equal(selectAutoModel(policy, "设计数据库迁移与权限协议，修复并测试跨模块实现，然后完成发布验收。").model, "gpt-complex");
  assert.deepEqual(classifyAutoModelPrompt("解释这个函数是什么", "balanced"), simple);
});

test("strategy thresholds are explainable and explicit incompatibility excludes auth, quota, and network failures", () => {
  const prompt = "实现这个组件并补测试";
  assert.equal(classifyAutoModelPrompt(prompt, "quality").classification, "complex");
  assert.equal(classifyAutoModelPrompt(prompt, "conservative").classification, "simple");
  assert.equal(isExplicitModelIncompatibility("unsupported_model: gpt-x is incompatible"), true);
  assert.equal(isExplicitModelIncompatibility("HTTP 401 authentication failed"), false);
  assert.equal(isExplicitModelIncompatibility("quota exceeded"), false);
  assert.equal(isExplicitModelIncompatibility("network timeout"), false);
});

test("Native Session model switching follows explicit Engine capability declarations", () => {
  assert.equal(engineSupportsPerRunModelSelection("codex"), true);
  assert.equal(engineSupportsPerRunModelSelection("claude-code"), true);
  assert.equal(engineSupportsPerRunModelSelection("rux-native"), false);
  assert.doesNotThrow(() => assertNativeSessionModelCompatibility("rux-native", "gpt-a", "gpt-a"));
  assert.throws(() => assertNativeSessionModelCompatibility("rux-native", "gpt-a", "gpt-b"), /新建 Task/);
});

test("Agent saves append immutable Auto policy Revisions and disabling Auto creates another Revision", () => {
  const root = mkdtempSync(join(tmpdir(), "rux-auto-profile-"));
  const store = new AgentProfileStore(join(root, "agents.json"));
  const created = store.create({
    name: "Auto Builder",
    backend: "codex",
    model: "gpt-simple",
    modelSource: "engine-catalog",
    modelVerificationStatus: "not-required",
    autoModelPolicy: policy,
    instructions: "Work carefully.",
  });
  const first = store.getRevision(created.latestRevisionId);
  assert.deepEqual(first?.autoModelPolicy, policy);
  const updated = store.update(created.id, { autoModelPolicy: null });
  assert.equal(updated.revisionNumber, 2);
  assert.equal(store.getRevision(updated.latestRevisionId)?.autoModelPolicy, undefined);
  assert.deepEqual(store.getRevision(created.latestRevisionId)?.autoModelPolicy, policy);
});

test("Model Decision and Token Usage schemas preserve boundary and source evidence", () => {
  const decision = runModelDecisionSchema.parse({
    id: "model-decision:run-1",
    runId: "run-1",
    mode: "auto",
    classification: "complex",
    actualModel: "gpt-complex",
    modelSource: "verified-history",
    strategy: "balanced",
    score: 8,
    threshold: 4,
    reasonCodes: ["architecture"],
    rationale: "Architecture work needs the complex model.",
    allowlist: ["gpt-simple", "gpt-complex"],
    engine: "codex",
    providerConnectionId: "cli:codex:default",
    agentRevisionId: "builtin:codex@1",
    decidedAt: "2026-08-14T00:00:00.000Z",
  });
  assert.equal(decision.actualModel, "gpt-complex");
  assert.throws(() => runModelDecisionSchema.parse({ ...decision, actualModel: "outside" }), /allowlist/);
  assert.equal(tokenUsageSchema.parse({
    source: "engine",
    scope: "task",
    aggregation: "cumulative",
    isEstimate: false,
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 5,
    reasoningOutputTokens: 2,
    totalTokens: 15,
    reportedAt: "2026-08-14T00:00:00.000Z",
  }).totalTokens, 15);
  assert.throws(() => tokenUsageSchema.parse({
    source: "estimate",
    scope: "task",
    aggregation: "cumulative",
    isEstimate: false,
    totalTokens: 10,
    reportedAt: "2026-08-14T00:00:00.000Z",
  }), /Estimated usage must be labeled/);
});

test("incremental Provider usage accumulates while cumulative Engine usage replaces the prior snapshot", () => {
  const first = { source: "provider", scope: "task", aggregation: "incremental", isEstimate: false, inputTokens: 10, outputTokens: 4, totalTokens: 14, reportedAt: "2026-08-14T00:00:00.000Z" };
  const second = { ...first, inputTokens: 6, outputTokens: 2, totalTokens: 8, reportedAt: "2026-08-14T00:00:01.000Z" };
  const accumulated = mergeTokenUsage(mergeTokenUsage(undefined, first), second);
  assert.equal(accumulated.inputTokens, 16);
  assert.equal(accumulated.outputTokens, 6);
  assert.equal(tokenUsageTotal(accumulated), 22);
  const cumulative = { source: "engine", scope: "task", aggregation: "cumulative", isEstimate: false, inputTokens: 3, outputTokens: 1, totalTokens: 4, reportedAt: "2026-08-14T00:00:02.000Z" };
  assert.deepEqual(mergeTokenUsage(accumulated, cumulative), cumulative);
  assert.equal(tokenUsageTotal(undefined), undefined);
});
