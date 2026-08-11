#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const marker = process.env.RUX_PROCESS_TREE_MARKER;
if (!marker) throw new Error("RUX_PROCESS_TREE_MARKER is required");

const grandchild = spawn(process.execPath, [
  "-e",
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
], {
  stdio: "ignore",
  windowsHide: true,
});

writeFileSync(marker, JSON.stringify({
  parentPid: process.pid,
  grandchildPid: grandchild.pid,
}), "utf8");

process.on("SIGTERM", () => {
  // Exercise the bounded SIGKILL fallback for both process-group members.
});
setInterval(() => {}, 1_000);
