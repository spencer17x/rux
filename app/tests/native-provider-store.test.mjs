import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NativeProviderStore } from "../src/electron/native-provider-store.ts";

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
  });

  assert.equal(saved.hasCredential, true);
  assert.equal(saved.baseUrl, "https://api.openai.com/v1");
  assert.equal("apiKey" in saved, false);
  assert.doesNotMatch(readFileSync(file, "utf8"), /secret-test-key/);
  assert.equal(store.runtimeCredentials()[0].apiKey, "secret-test-key");
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
