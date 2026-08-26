import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "./settings-store";

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

describe("SettingsStore", () => {
  it("round-trips validated public settings", async () => {
    root = mkdtempSync(join(tmpdir(), "rux-settings-")); const store = new SettingsStore(join(root, "settings.json"));
    const saved = await store.save({ provider: "custom", baseUrl: "https://example.test/v1/", model: "model", uiFontSize: 99 });
    expect(saved).toMatchObject({ provider: "custom", baseUrl: "https://example.test/v1/", model: "model", uiFontSize: 16 });
    expect(store.public(await store.load())).not.toHaveProperty("encryptedApiKey");
  });

  it("falls back safely when the settings file is missing", async () => {
    root = mkdtempSync(join(tmpdir(), "rux-settings-")); const store = new SettingsStore(join(root, "missing.json"));
    expect(await store.load()).toMatchObject({ provider: "codex", sandboxMode: "workspace-write", reasoning: "high" });
  });
});
