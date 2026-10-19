import { describe, expect, it } from "vitest";
import { matchShortcut, shortcuts } from "./shortcuts";

function press(key: string, modifiers: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) {
  return {
    key,
    metaKey: Boolean(modifiers.meta),
    ctrlKey: Boolean(modifiers.ctrl),
    altKey: Boolean(modifiers.alt),
    shiftKey: Boolean(modifiers.shift),
  };
}

describe("keyboard shortcuts", () => {
  it("matches the primary bindings on macOS and Windows", () => {
    expect(matchShortcut(press("n", { meta: true }))?.id).toBe("newStandalone");
    expect(matchShortcut(press("N", { ctrl: true }))?.id).toBe("newStandalone");
    expect(matchShortcut(press("b", { meta: true }))?.id).toBe("toggleLeftPanel");
    expect(matchShortcut(press(",", { meta: true }))?.id).toBe("settings");
  });

  it("matches the chorded workspace bindings", () => {
    expect(matchShortcut(press("`", { ctrl: true }))?.id).toBe("terminal");
    expect(matchShortcut(press("g", { ctrl: true, shift: true }))?.id).toBe("review");
    expect(matchShortcut(press("p", { meta: true }))?.id).toBe("files");
    expect(matchShortcut(press("r", { meta: true, alt: true }))?.id).toBe("remote");
    expect(matchShortcut(press("s", { meta: true, alt: true }))?.id).toBe("sideChat");
  });

  it("does not fire without the required modifiers", () => {
    expect(matchShortcut(press("n"))).toBeNull();
    expect(matchShortcut(press("g", { ctrl: true }))).toBeNull();
    expect(matchShortcut(press("r", { meta: true }))).toBeNull();
    expect(matchShortcut(press("escape"))).toBeNull();
  });

  it("no longer binds the old browser shortcut", () => {
    expect(matchShortcut(press("t", { meta: true }))).toBeNull();
  });

  it("keeps ids, labels and displayed keys unique", () => {
    for (const field of ["id", "label", "keys"] as const) {
      expect(new Set(shortcuts.map((shortcut) => shortcut[field])).size).toBe(shortcuts.length);
    }
    expect(shortcuts.every((shortcut) => shortcut.label.trim() && shortcut.keys.trim())).toBe(true);
  });
});
