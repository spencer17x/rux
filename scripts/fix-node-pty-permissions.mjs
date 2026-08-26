import { chmod, readdir } from "node:fs/promises";
import { join } from "node:path";

if (process.platform !== "win32") {
  const prebuilds = join(process.cwd(), "node_modules", "node-pty", "prebuilds");
  try {
    for (const target of await readdir(prebuilds)) {
      if (!target.startsWith("darwin-") && !target.startsWith("linux-")) continue;
      await chmod(join(prebuilds, target, "spawn-helper"), 0o755).catch(() => {});
    }
  } catch {
    // node-pty may be intentionally omitted for a renderer-only install.
  }
}
