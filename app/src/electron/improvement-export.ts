import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ImprovementAsset, ImprovementExportTarget } from "../shared/protocol.ts";

export function improvementAssetSlug(name: string, assetId: string): string {
  const normalized = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || `rux-skill-${assetId.slice(0, 8).toLowerCase()}`;
}

export function improvementAssetContent(asset: ImprovementAsset, description: string, target: ImprovementExportTarget): { engine: "codex" | "rux"; fileName: string; content: string } {
  const slug = improvementAssetSlug(asset.name, asset.id);
  if (target === "project-codex" || target === "user-codex") {
    if (!['skill', 'workflow'].includes(asset.type)) throw new Error("IMPROVEMENT_EXPORT_UNSUPPORTED: Codex export supports Skill/Workflow assets through SKILL.md; project rules remain Rux-managed");
    const safeDescription = description.replace(/\s+/g, " ").trim().slice(0, 500) || `Use ${asset.name} when its documented workflow applies.`;
    return { engine: "codex", fileName: `${slug}/SKILL.md`, content: `---\nname: ${slug}\ndescription: ${JSON.stringify(safeDescription)}\n---\n\n${asset.content.trim()}\n` };
  }
  return { engine: "rux", fileName: `${slug}.rux.md`, content: `---\nformat: rux-improvement/v1\nid: ${asset.id}\ntype: ${asset.type}\nscope: ${asset.scope}\nversion: ${asset.version}\nname: ${JSON.stringify(asset.name)}\n---\n\n${asset.content.trim()}\n` };
}

export function improvementFileHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function improvementExportDiff(before: string, after: string): string {
  if (before === after) return "No content changes.";
  const beforeLines = before.split("\n").slice(0, 500).map((line) => `-${line}`);
  const afterLines = after.split("\n").slice(0, 500).map((line) => `+${line}`);
  return ["--- current", "+++ proposed", "@@ full-file export @@", ...beforeLines, ...afterLines].join("\n").slice(0, 100_000);
}

export function assertImprovementExportPath(baseDirectory: string, targetPath: string): void {
  const requestedBase = resolve(baseDirectory);
  const target = resolve(targetPath);
  const targetRelative = relative(requestedBase, target);
  if (!targetRelative || isAbsolute(targetRelative) || targetRelative === ".." || targetRelative.startsWith(`..${sep}`)) throw new Error("IMPROVEMENT_EXPORT_PATH_INVALID: Export target escaped the selected directory");
  let current = realpathSync(requestedBase);
  for (const segment of targetRelative.split(sep)) {
    current = resolve(current, segment);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) throw new Error("IMPROVEMENT_EXPORT_PATH_INVALID: Export target contains a symbolic-link component");
  }
}
