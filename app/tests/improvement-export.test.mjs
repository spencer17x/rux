import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertImprovementExportPath, improvementAssetContent, improvementAssetSlug, improvementExportDiff } from "../src/electron/improvement-export.ts";

const asset = {
  id: "asset-12345678", candidateId: "candidate-1", type: "skill", scope: "project", projectId: "project-1",
  version: 2, name: "Desktop QA", content: "Run the packaged desktop click path.", status: "active", createdAt: "2026-08-17T10:00:00.000Z",
  formatVersion: 1, storage: "rux-managed", evaluation: { status: "unknown", checks: [], evidenceCount: 1, evaluatedAt: "2026-08-17T10:00:00.000Z" },
};

test("exports official Codex SKILL.md metadata only for Skill assets", () => {
  assert.equal(improvementAssetSlug("Desktop QA", asset.id), "desktop-qa");
  const rendered = improvementAssetContent(asset, "Use for packaged desktop verification.", "project-codex");
  assert.equal(rendered.fileName, "desktop-qa/SKILL.md");
  assert.match(rendered.content, /^---\nname: desktop-qa\ndescription: "Use for packaged desktop verification\."\n---/);
  assert.match(improvementAssetContent({ ...asset, type: "workflow" }, "Workflow", "project-codex").fileName, /SKILL\.md$/);
  assert.throws(() => improvementAssetContent({ ...asset, type: "project-rule" }, "Rule", "project-codex"), /IMPROVEMENT_EXPORT_UNSUPPORTED/);
  const rux = improvementAssetContent({ ...asset, type: "workflow" }, "Workflow", "custom-rux");
  assert.equal(rux.engine, "rux");
  assert.match(rux.content, /format: rux-improvement\/v1/);
  assert.match(improvementExportDiff("old\n", "new\n"), /--- current[\s\S]*\+new/);
});

test("export path validation rejects traversal and symlink components", () => {
  const root = mkdtempSync(join(tmpdir(), "rux-improvement-export-"));
  const outside = mkdtempSync(join(tmpdir(), "rux-improvement-outside-"));
  mkdirSync(join(root, ".agents"), { recursive: true });
  symlinkSync(outside, join(root, ".agents", "skills"));
  assert.throws(() => assertImprovementExportPath(root, join(root, ".agents", "skills", "demo", "SKILL.md")), /symbolic-link/);
  assert.throws(() => assertImprovementExportPath(root, join(root, "..", "escaped.md")), /escaped/);
});
