import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { agentDataPaths } from "./agent-data";
import { AgentConfigSync } from "./agent-config-sync";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it("offers changed configuration only, imports after acceptance, and never copies credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "rux-config-sync-")); roots.push(root);
  const managed = join(root, ".rux");
  const external = join(root, ".codex");
  await mkdir(external);
  await writeFile(join(external, "config.toml"), "model = 'first'\n");
  await writeFile(join(external, "auth.json"), "secret");
  const service = new AgentConfigSync(managed, agentDataPaths(managed), { codex: external, "claude-code": join(root, ".claude"), pi: join(root, ".pi", "agent") });

  const first = await service.check("codex");
  expect(first.files.map((file) => file.name)).toEqual(["config.toml"]);
  await service.dismiss(first);
  expect((await service.check("codex")).files).toEqual([]);
  expect((await service.check("codex", true)).files.map((file) => file.name)).toEqual(["config.toml"]);
  await writeFile(join(external, "config.toml"), "model = 'second'\n");
  const second = await service.check("codex");
  await service.apply(second);
  expect(await readFile(join(managed, "agents", "codex", "config.toml"), "utf8")).toBe("model = 'second'\n");
  await expect(readFile(join(managed, "agents", "codex", "auth.json"))).rejects.toThrow();
  expect((await service.check("codex")).files).toEqual([]);
});

it("rejects a stale acceptance when the external file changes again", async () => {
  const root = await mkdtemp(join(tmpdir(), "rux-config-sync-")); roots.push(root);
  const external = join(root, ".claude");
  await mkdir(external);
  await writeFile(join(external, "settings.json"), "{\"version\":1}");
  const managed = join(root, ".rux");
  const service = new AgentConfigSync(managed, agentDataPaths(managed), { codex: join(root, ".codex"), "claude-code": external, pi: join(root, ".pi", "agent") });
  const status = await service.check("claude-code");
  await writeFile(join(external, "settings.json"), "{\"version\":2}");
  await expect(service.apply(status)).rejects.toThrow("配置已变化");
  await expect(readFile(join(managed, "agents", "claude-code", "settings.json"))).rejects.toThrow();
});
