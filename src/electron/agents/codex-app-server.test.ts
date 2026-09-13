import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./codex-app-server";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
const clients: CodexAppServerClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.stop(); spawn.mockReset(); });
function setup(failTurn = false) {
  const children: any[] = [];
  spawn.mockImplementation(() => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), kill: vi.fn(), stdin: { destroyed: false, write: (data: string) => {
      const request = JSON.parse(data); if (request.id === undefined) return;
      const response = failTurn && request.method === "turn/start" ? { id: request.id, error: { message: "refresh_token_reused" } } : { id: request.id, result: request.method.startsWith("thread/") ? { thread: { id: "thread" }, model: "model" } : {} };
      queueMicrotask(() => stdout.write(`${JSON.stringify(response)}\n`));
    } } });
    children.push(child); return child;
  });
  const client = new CodexAppServerClient(() => "codex", vi.fn()); clients.push(client);
  return { client, children };
}
it("ignores a stopped account process exiting after its replacement is started", async () => {
  const { client, children } = setup();
  await client.readThread("thread"); client.stop();
  await client.readThread("thread"); children[0].emit("close", 0);
  await expect(client.readThread("thread")).resolves.toMatchObject({ id: "thread" });
  expect(spawn).toHaveBeenCalledTimes(2);
});
it("clears failed start requests so reauthentication is not blocked by phantom work", async () => {
  const { client } = setup(true);
  await expect(client.startTurn({ runId: "run", cwd: "/tmp", prompt: "hello", model: "model", sandboxMode: "read-only" })).rejects.toThrow("refresh_token_reused");
  expect(client.hasActiveRuns).toBe(false);
});
it("does not let cancelled initialization clear a replacement connection", async () => {
  const { client } = setup();
  const first = client.readThread("thread"); const failed = expect(first).rejects.toThrow("已停止");
  client.stop();
  await client.readThread("thread"); await failed;
  await client.readThread("thread"); expect(spawn).toHaveBeenCalledTimes(2);
});
