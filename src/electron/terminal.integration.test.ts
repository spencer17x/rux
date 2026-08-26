import { describe, expect, it } from "vitest";
import { spawn } from "node-pty";

describe("PTY integration", () => {
  it("starts the platform shell and streams terminal output", async () => {
    const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "echo RUX_PTY_OK"] : ["-lc", "printf RUX_PTY_OK"];
    const output = await new Promise<string>((resolve, reject) => {
      const terminal = spawn(shell, args, { name: "xterm-256color", cols: 80, rows: 24, cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")) });
      let text = "";
      const timeout = setTimeout(() => { terminal.kill(); reject(new Error("PTY smoke test timed out")); }, 10_000);
      terminal.onData((chunk) => { text += chunk; });
      terminal.onExit(() => { clearTimeout(timeout); resolve(text); });
    });
    expect(output).toContain("RUX_PTY_OK");
  });
});
