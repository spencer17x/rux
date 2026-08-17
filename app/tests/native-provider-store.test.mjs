import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NativeProviderStore } from "../src/electron/native-provider-store.ts";
import { nativeProviderConnectionInputSchema, runStartParamsSchema } from "../src/shared/protocol.ts";

test("Native Provider custom headers reject reserved overrides, duplicates, and line injection", () => {
  const base = { label: "Headers", providerType: "openai-responses", baseUrl: "https://example.com/v1", defaultModel: "model", apiKey: "secret" };
  assert.equal(nativeProviderConnectionInputSchema.parse({ ...base, customHeaders: [{ name: "X-Tenant", value: "tenant-a" }] }).customHeaders[0].name, "X-Tenant");
  assert.throws(() => nativeProviderConnectionInputSchema.parse({ ...base, customHeaders: [{ name: "Authorization", value: "replacement" }] }), /managed by Rux/);
  assert.throws(() => nativeProviderConnectionInputSchema.parse({ ...base, providerType: "anthropic-messages", customHeaders: [{ name: "x-api-key", value: "replacement" }] }), /managed by Rux/);
  assert.throws(() => nativeProviderConnectionInputSchema.parse({ ...base, providerType: "anthropic-messages", customHeaders: [{ name: "anthropic-version", value: "future" }] }), /managed by Rux/);
  assert.equal(nativeProviderConnectionInputSchema.parse({ ...base, baseUrl: "http://[::1]:3000/v1" }).baseUrl, "http://[::1]:3000/v1");
  assert.throws(() => nativeProviderConnectionInputSchema.parse({ ...base, baseUrl: "https://example.com/v1?api_key=secret" }), /query or fragment/);
  assert.throws(() => nativeProviderConnectionInputSchema.parse({ ...base, customHeaders: [{ name: "X-Tenant", value: "a" }, { name: "x-tenant", value: "b" }] }), /unique/);
  assert.throws(() => nativeProviderConnectionInputSchema.parse({ ...base, customHeaders: [{ name: "X-Tenant", value: "a\r\nInjected: value" }] }), /line breaks/);
});

test("Run protocol accepts bounded Rux-owned conversation history for stateless Provider APIs", () => {
  const parsed = runStartParamsSchema.parse({
    runId: "run-history",
    adapter: "rux-native",
    prompt: "continue",
    permissionMode: "acceptEdits",
    profileId: "agent:history",
    agentRevisionId: "agent-revision:history@1",
    providerConnectionId: "native:rux-native:history",
    conversationHistory: [{ role: "user", content: "remember" }, { role: "assistant", content: "remembered" }],
  });
  assert.equal(parsed.conversationHistory.length, 2);
  assert.throws(() => runStartParamsSchema.parse({ ...parsed, conversationHistory: [{ role: "system", content: "override" }] }));
});

test("Native Provider Store persists only encrypted credentials and returns sanitized metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-store-"));
  const file = join(directory, "connections.json");
  const codec = {
    available: () => true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decrypt: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const store = new NativeProviderStore(file, codec);
  const saved = store.save({
    label: "OpenAI",
    providerType: "openai-responses",
    baseUrl: "https://api.openai.com/v1/",
    defaultModel: "gpt-test",
    apiKey: "secret-test-key",
    customHeaders: [{ name: "OpenAI-Organization", value: "secret-org" }],
  });

  assert.equal(saved.hasCredential, true);
  assert.equal(saved.baseUrl, "https://api.openai.com/v1");
  assert.equal("apiKey" in saved, false);
  assert.deepEqual(saved.customHeaderNames, ["OpenAI-Organization"]);
  assert.doesNotMatch(readFileSync(file, "utf8"), /secret-test-key/);
  assert.doesNotMatch(readFileSync(file, "utf8"), /secret-org/);
  assert.equal(store.runtimeCredentials()[0].apiKey, "secret-test-key");
  assert.deepEqual(store.runtimeCredentials()[0].customHeaders, [{ name: "OpenAI-Organization", value: "secret-org" }]);
});

test("Native Provider Store edits metadata without replacing a blank credential and replaces it only when supplied", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-store-"));
  const store = new NativeProviderStore(join(directory, "connections.json"), {
    available: () => true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decrypt: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  });
  const created = store.save({ label: "First", providerType: "openai-responses", baseUrl: "https://example.com/v1", defaultModel: "model-a", apiKey: "key-a" });
  store.save({ id: created.id, label: "Renamed", providerType: "openai-responses", baseUrl: "https://api.example.com/v1", defaultModel: "model-b" });
  assert.equal(store.runtimeCredentials()[0].apiKey, "key-a");
  assert.equal(store.list()[0].label, "Renamed");
  store.save({ id: created.id, label: "Renamed", providerType: "openai-responses", baseUrl: "https://api.example.com/v1", defaultModel: "model-b", apiKey: "key-b" });
  assert.equal(store.runtimeCredentials()[0].apiKey, "key-b");
  store.save({ id: created.id, label: "Renamed", providerType: "openai-responses", baseUrl: "https://api.example.com/v1", defaultModel: "model-b", customHeaders: [{ name: "X-Tenant", value: "tenant-a" }] });
  assert.deepEqual(store.list()[0].customHeaderNames, ["X-Tenant"]);
  assert.deepEqual(store.runtimeCredentials()[0].customHeaders, [{ name: "X-Tenant", value: "tenant-a" }]);
  store.save({ id: created.id, label: "Renamed", providerType: "openai-responses", baseUrl: "https://api.example.com/v1", defaultModel: "model-b", customHeaders: [] });
  assert.deepEqual(store.list()[0].customHeaderNames, []);
  assert.deepEqual(store.runtimeCredentials()[0].customHeaders, []);
  store.delete(created.id);
  assert.deepEqual(store.list(), []);
});

test("Native Provider Store fails closed when OS encryption is unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-store-"));
  const store = new NativeProviderStore(join(directory, "connections.json"), {
    available: () => false,
    encrypt: () => { throw new Error("must not encrypt"); },
    decrypt: () => { throw new Error("must not decrypt"); },
  });
  assert.throws(() => store.save({
    label: "Blocked",
    providerType: "openai-responses",
    baseUrl: "https://example.com/v1",
    defaultModel: "model",
    apiKey: "secret",
  }), /credential encryption is unavailable/);
});

test("Native Provider Store preserves corrupt bytes and refuses writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-store-"));
  const file = join(directory, "connections.json");
  writeFileSync(file, "not-json");
  const store = new NativeProviderStore(file, {
    available: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString("utf8"),
  });
  assert.throws(() => store.save({ label: "No overwrite", providerType: "openai-responses", baseUrl: "https://example.com/v1", defaultModel: "model", apiKey: "secret" }), /was preserved/);
  assert.equal(readFileSync(file, "utf8"), "not-json");
});

test("Native Provider Store rejects a future version without overwriting it", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-future-"));
  const file = join(directory, "connections.json");
  const future = `${JSON.stringify({ version: 99, connections: [] })}\n`;
  writeFileSync(file, future, { mode: 0o600 });
  const codec = { available: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString("utf8") };
  const store = new NativeProviderStore(file, codec);
  assert.throws(() => store.save({ label: "Blocked", providerType: "openai-responses", baseUrl: "https://example.com/v1", defaultModel: "model", apiKey: "secret" }), /Unsupported Native Provider store version/);
  assert.equal(readFileSync(file, "utf8"), future);
});

test("Native Provider credential diagnostics never expose secrets and migration rewraps atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-migrate-"));
  const file = join(directory, "connections.json");
  let generation = "v1";
  const codec = {
    available: () => true,
    encrypt: (value) => Buffer.from(`${generation}:${value}`, "utf8"),
    decrypt: (value) => value.toString("utf8").replace(/^v[12]:/, ""),
  };
  const store = new NativeProviderStore(file, codec);
  store.save({ label: "Private", providerType: "openai-responses", baseUrl: "https://example.com/v1", defaultModel: "model", apiKey: "top-secret", customHeaders: [{ name: "X-Tenant", value: "secret-tenant" }] });
  const diagnostics = store.diagnose("test-safe-storage");
  assert.equal(diagnostics.status, "healthy");
  assert.equal(diagnostics.decryptableCount, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /top-secret|secret-tenant/);

  generation = "v2";
  const migrated = store.migrateCredentials("test-safe-storage");
  assert.equal(migrated.migratedConnections, 1);
  assert.match(migrated.backupFileName, /^connections\.json\.backup-/);
  assert.match(readFileSync(file, "utf8"), /djI6/);
  assert.equal(store.runtimeCredentials()[0].apiKey, "top-secret");
  assert.equal(readdirSync(directory).filter((name) => name.includes(".backup-")).length, 1);
});

test("Native Provider credential diagnostics fail closed when ciphertext cannot be decrypted", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-native-provider-diagnostics-"));
  const file = join(directory, "connections.json");
  const working = new NativeProviderStore(file, { available: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString("utf8") });
  working.save({ label: "Broken", providerType: "openai-responses", baseUrl: "https://example.com/v1", defaultModel: "model", apiKey: "secret" });
  const broken = new NativeProviderStore(file, { available: () => true, encrypt: (value) => Buffer.from(value), decrypt: () => { throw new Error("key changed"); } });
  const diagnostics = broken.diagnose("test-safe-storage");
  assert.equal(diagnostics.status, "credential-error");
  assert.deepEqual(diagnostics.failedConnectionLabels, ["Broken"]);
  assert.equal(diagnostics.migrationAvailable, false);
  assert.throws(() => broken.migrateCredentials("test-safe-storage"), /migration is unavailable/);
});
