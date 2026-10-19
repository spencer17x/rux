import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { migrateRuxDataRoot, ruxDataRoot } from "./data-root";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("uses ~/.rux except when an explicit Electron data directory is supplied", () => {
  // Expressed with join() so the expectation follows the host separator.
  expect(ruxDataRoot("/old/rux", [], "/home/user")).toBe(join("/home/user", ".rux"));
  expect(ruxDataRoot("/isolated", ["--user-data-dir=/isolated"], "/home/user")).toBe("/isolated");
});

it("copies legacy data without replacing data already in ~/.rux", () => {
  const root = mkdtempSync(join(tmpdir(), "rux-data-root-")); roots.push(root);
  const previous = join(root, "old"); const next = join(root, ".rux");
  mkdirSync(join(previous, "agents", "codex"), { recursive: true });
  mkdirSync(next);
  writeFileSync(join(previous, "settings.json"), "old settings");
  writeFileSync(join(previous, "agents", "codex", "session.jsonl"), "session");
  writeFileSync(join(next, "settings.json"), "new settings");
  migrateRuxDataRoot(previous, next);
  expect(readFileSync(join(next, "settings.json"), "utf8")).toBe("new settings");
  expect(readFileSync(join(next, "agents", "codex", "session.jsonl"), "utf8")).toBe("session");
  expect(existsSync(join(next, ".legacy-user-data-imported"))).toBe(true);
  expect(readFileSync(join(previous, "settings.json"), "utf8")).toBe("old settings");
});
