import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { CodexAuthSession } from "./codex-auth-session";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rux-auth-")); roots.push(root);
  const path = join(root, "rux-auth-state.json");
  const session = new CodexAuthSession(path); await session.initialize();
  return { root, path, session };
}
it("requires independent login for legacy credentials without deleting them", async () => {
  const { root, path, session } = await fixture();
  await writeFile(join(root, "auth.json"), "external-credential-placeholder");
  expect(() => session.assertReady()).toThrow("重新登录");
  expect(session.status()).toMatchObject({ connected: false, reauthRequired: true, account: null });
  expect(await readFile(join(root, "auth.json"), "utf8")).toBe("external-credential-placeholder");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, requiresLogin: true });
});
it("persists successful login and invalidation across restarts", async () => {
  const { path, session } = await fixture();
  session.begin(); await session.finish(true);
  const restarted = new CodexAuthSession(path); await restarted.initialize();
  expect(() => restarted.assertReady()).not.toThrow();
  await restarted.expire();
  const invalid = new CodexAuthSession(path); await invalid.initialize();
  expect(() => invalid.assertReady()).toThrow("重新登录");
});
it("blocks turns during login and stays disconnected after cancellation", async () => {
  const { session } = await fixture();
  session.begin();
  expect(() => session.begin()).toThrow("正在进行");
  await expect(session.run(async () => "never")).rejects.toThrow("切换登录状态");
  await session.finish(false);
  expect(session.changing).toBe(false);
  expect(session.required).toBe(true);
});
it("does not change auth while a Codex request or side-chat is in flight", async () => {
  const { session } = await fixture(); session.begin(); await session.finish(true);
  let finish!: () => void;
  const pending = session.run(() => new Promise<void>(resolve => { finish = resolve; }));
  expect(() => session.begin()).toThrow("请先停止");
  finish(); await pending;
  expect(() => session.begin()).not.toThrow();
  await session.finish(false);
});
it("fails closed on corrupt provenance and serializes state writes", async () => {
  const { path, session } = await fixture();
  session.begin(); await Promise.all([session.expire(), session.finish(true)]);
  expect(JSON.parse(await readFile(path, "utf8")).requiresLogin).toBe(false);
  await writeFile(path, "broken");
  const recovered = new CodexAuthSession(path); await recovered.initialize();
  expect(recovered.required).toBe(true);
});
