import { spawn } from "node:child_process";
import type { ProcessResult, RunProcess } from "./ipc-types";

export const runProcess: RunProcess = async (command, args, options = {}): Promise<ProcessResult> => await new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; let settled = false;
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => { stdout += chunk; }); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const finish = (error?: Error, code = 1) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve({ stdout, stderr, code }); };
  child.on("error", (error) => finish(error)); child.on("close", (code) => finish(undefined, code ?? 1));
  const timeout = setTimeout(() => { child.kill("SIGTERM"); finish(new Error("操作超时")); }, options.timeoutMs ?? 120_000);
  if (options.input) child.stdin.write(options.input); child.stdin.end();
});
