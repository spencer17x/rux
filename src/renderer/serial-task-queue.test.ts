import { describe, expect, it } from "vitest";
import { SerialTaskQueue } from "./serial-task-queue";

describe("SerialTaskQueue", () => {
  it("preserves submission order across asynchronous work", async () => {
    const queue = new SerialTaskQueue(); const output: string[] = [];
    const first = queue.run(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); output.push("first"); });
    const second = queue.run(async () => { output.push("second"); });
    await Promise.all([first, second]);
    expect(output).toEqual(["first", "second"]);
  });

  it("continues after a failed task", async () => {
    const queue = new SerialTaskQueue();
    await expect(queue.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });
});
