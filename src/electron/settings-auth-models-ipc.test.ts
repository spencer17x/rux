import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CodexAuthSession } from "./codex-auth-session";
import { SettingsAuthModelsIpc } from "./settings-auth-models-ipc";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
const roots: string[] = [];
afterEach(async () => { spawn.mockReset(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "rux-login-test-")); roots.push(root);
  const session = new CodexAuthSession(join(root, "state.json")); await session.initialize();
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValue(child);
  const handlers = new Map<string, Function>(); const events: any[] = [];
  const reset = vi.fn(); const runProcess = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
  const service = new SettingsAuthModelsIpc({ authSession: session, resetCodexClients: reset, runtimeManager: { ensure: async () => {}, status: async () => ({ installed: true }) }, codexExecutable: () => "/managed/codex", codexEnvironment: () => ({ CODEX_HOME: root }), getWindow: () => ({ webContents: { send: (_channel: string, event: any) => events.push(event) } }), runProcess, loadCodexAccount: async () => ({ connected: true, account: { email: "signed-in@example.test" } }) } as any);
  service.register({ handle: (channel, handler) => { handlers.set(channel, handler); } });
  return { session, child, root, events, reset, runProcess, service, invoke: (channel: string) => handlers.get(channel)!({}) };
}
it("clears only Rux credentials and deduplicates login until independent auth succeeds", async () => {
  const h = await setup();
  await expect(h.invoke("auth:login")).resolves.toEqual({ started: true });
  await expect(h.invoke("auth:login")).resolves.toMatchObject({ alreadyRunning: true });
  expect(h.runProcess).toHaveBeenCalledWith("/managed/codex", ["logout"], expect.objectContaining({ env: { CODEX_HOME: h.root } }));
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0][2].env.CODEX_HOME).toBe(h.root);
  expect(await h.invoke("auth:status")).toMatchObject({ connected: false, loginInProgress: true });
  h.child.stdout.write("Visit the device login page. Code: TEST-CODE");
  expect(h.events.some(event => event.type === "output" && event.text.includes("TEST-CODE"))).toBe(true);
  h.child.emit("close", 0);
  await expect.poll(() => h.session.changing).toBe(false);
  expect(h.session.required).toBe(false);
  expect(h.reset).toHaveBeenCalledTimes(2);
  expect(await h.invoke("auth:status")).toMatchObject({ connected: true });
});
it("keeps failed login disconnected and permits a fresh attempt", async () => {
  const h = await setup(); await h.invoke("auth:login"); h.child.emit("close", 1);
  await expect.poll(() => h.session.changing).toBe(false);
  expect(await h.invoke("auth:status")).toMatchObject({ connected: false, reauthRequired: true });
  await h.invoke("auth:login"); expect(spawn).toHaveBeenCalledTimes(2);
  h.service.stop(); await expect.poll(() => h.session.changing).toBe(false);
});
it("does not terminate active Codex work or invalidate its account", async () => {
  const h = await setup(); h.session.begin(); await h.session.finish(true);
  h.reset.mockImplementation(() => { throw new Error("请先停止正在运行的 Codex 任务"); });
  await expect(h.invoke("auth:login")).rejects.toThrow("请先停止");
  expect(h.session.required).toBe(false); expect(h.session.changing).toBe(false);
  expect(spawn).not.toHaveBeenCalled(); expect(h.runProcess).not.toHaveBeenCalled();
});
it("releases the login UI when credential cleanup fails before the login process starts", async () => {
  const h = await setup();
  h.runProcess.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "failed" });
  await expect(h.invoke("auth:login")).rejects.toThrow("清理");
  expect(h.session.changing).toBe(false);
  expect(h.events.at(-1)).toMatchObject({ type: "auth-required", loginInProgress: false });
  await h.invoke("auth:login"); expect(spawn).toHaveBeenCalledTimes(1);
  h.service.stop(); await expect.poll(() => h.session.changing).toBe(false);
});
