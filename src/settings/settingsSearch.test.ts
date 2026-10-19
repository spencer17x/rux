import { describe, expect, it } from "vitest";
import { matchSettings, settingsSearchIndex } from "./settingsSearch";

describe("settings search", () => {
  it("returns nothing for an empty query", () => {
    expect(matchSettings("")).toEqual([]);
    expect(matchSettings("   ")).toEqual([]);
  });

  it("finds settings by the words users actually type", () => {
    expect(matchSettings("字体").map((entry) => entry.label)).toContain("UI 字号");
    expect(matchSettings("API key").map((entry) => entry.section)).toEqual(expect.arrayContaining(["providers", "models"]));
    expect(matchSettings("提交").map((entry) => entry.section)).toContain("git");
    expect(matchSettings("退出登录").map((entry) => entry.section)).toContain("models");
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchSettings("  api KEY  ").length).toBeGreaterThan(0);
    expect(matchSettings("THEME").map((entry) => entry.section)).toContain("appearance");
  });

  it("returns no results for an unknown term", () => {
    expect(matchSettings("zzzz-no-such-setting")).toEqual([]);
  });

  it("covers every settings section", () => {
    expect(new Set(settingsSearchIndex.map((entry) => entry.section))).toEqual(new Set([
      "general", "agents", "providers", "appearance", "permissions", "models", "shortcuts", "git", "environment",
    ]));
    expect(settingsSearchIndex.every((entry) => entry.label.trim() && entry.keywords.trim())).toBe(true);
  });
});
