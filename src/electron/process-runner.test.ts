import { describe, expect, it } from "vitest";
import { runProcess } from "./process-runner";

describe("runProcess", () => {
  it("captures stdout, stderr, and exit status", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exitCode=3"]);
    expect(result).toEqual({ stdout: "out", stderr: "err", code: 3 });
  });

  it("terminates timed-out commands", async () => {
    await expect(runProcess(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], { timeoutMs: 20 })).rejects.toThrow("操作超时");
  });
});
