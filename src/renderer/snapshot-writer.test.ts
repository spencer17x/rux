import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotWriter } from "./snapshot-writer";

afterEach(() => vi.useRealTimers());
describe("snapshot persistence", () => {
  it("coalesces rapid updates and saves during uninterrupted streaming", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_value: number) => {});
    const writer = new SnapshotWriter(save, vi.fn());
    for (let index = 0; index < 100; index++) { writer.schedule(index); await vi.advanceTimersByTimeAsync(10); }
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(99);
  });
  it("orders slow writes and keeps only the latest queued snapshot", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; })).mockResolvedValue(undefined);
    const writer = new SnapshotWriter<number>(save, vi.fn());
    writer.schedule(1); const first = writer.flush(); await Promise.resolve();
    writer.schedule(2); writer.schedule(3); const final = writer.flush();
    expect(save).toHaveBeenCalledTimes(1);
    resolve(); await first; await final;
    expect(save.mock.calls.map(([value]) => value)).toEqual([1, 3]);
  });
  it("reports a failed write and allows later saves", async () => {
    const error = vi.fn(); const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const writer = new SnapshotWriter<number>(save, error);
    writer.schedule(1); await writer.flush(); writer.schedule(2); await writer.flush();
    expect(error).toHaveBeenCalledTimes(1); expect(save).toHaveBeenLastCalledWith(2);
  });
});

it("retains a failed snapshot for an explicit retry without another edit", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("temporary disk error")).mockResolvedValue(undefined);
  const writer = new SnapshotWriter<number>(save, vi.fn());
  writer.schedule(42);
  await writer.flush();
  await writer.flush();
  expect(save.mock.calls).toEqual([[42], [42]]);
});
