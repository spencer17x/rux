import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const releaseDirectory = resolve(process.argv[2] || "release");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const artifactPattern = new RegExp(`^Rux-${packageJson.version.replaceAll(".", "\\.")}-`);
const entries = await readdir(releaseDirectory, { withFileTypes: true });
const artifacts = [];

for (const entry of entries) {
  if (!entry.isFile() || !artifactPattern.test(entry.name) || entry.name.endsWith(".blockmap")) continue;
  const path = join(releaseDirectory, entry.name);
  const bytes = await readFile(path);
  const details = await stat(path);
  artifacts.push({
    name: basename(path),
    bytes: details.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

if (!artifacts.length) throw new Error(`No Rux ${packageJson.version} release artifacts found in ${releaseDirectory}`);
artifacts.sort((left, right) => left.name.localeCompare(right.name));
const manifest = {
  schemaVersion: 1,
  product: "Rux",
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  artifacts,
};
await writeFile(join(releaseDirectory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(releaseDirectory, "SHA256SUMS.txt"), `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n")}\n`, { mode: 0o600 });
console.log(`Wrote checksums for ${artifacts.length} Rux ${packageJson.version} artifact(s)`);
