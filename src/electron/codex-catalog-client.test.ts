import { expect, it, vi } from "vitest";
import { CodexCatalogClient } from "./codex-catalog-client";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
it("does not start a stale catalog process after an account change during runtime setup", async () => {
  let ready!: () => void;
  const catalog = new CodexCatalogClient({ ensure: () => new Promise<void>(resolve => { ready = resolve; }) } as any, () => "codex", vi.fn());
  const request = catalog.models(); const cancelled = expect(request).rejects.toThrow("账户已变更");
  catalog.stop(); ready(); await cancelled;
  expect(spawn).not.toHaveBeenCalled();
});
