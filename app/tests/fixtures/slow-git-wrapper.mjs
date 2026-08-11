#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const realGit = process.env.RUX_REAL_GIT;
if (!realGit) throw new Error("RUX_REAL_GIT is required");

if (args.includes("restore") && args.includes("--source=HEAD")) {
  const marker = process.env.RUX_PROCESS_TREE_MARKER;
  if (!marker) throw new Error("RUX_PROCESS_TREE_MARKER is required");
  const grandchild = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
  ], { stdio: "ignore", windowsHide: true });
  writeFileSync(marker, JSON.stringify({
    parentPid: process.pid,
    grandchildPid: grandchild.pid,
  }), "utf8");
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else {
  const result = spawnSync(realGit, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
