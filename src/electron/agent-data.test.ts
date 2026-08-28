import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentDataPaths, prepareAgentData } from "./agent-data";

const roots: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;
const originalClaudeHome = process.env.CLAUDE_CONFIG_DIR;

afterEach(async () => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalCodexHome;
  if (originalClaudeHome === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = originalClaudeHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prepareAgentData", () => {
  it("moves only Rux-owned native transcripts into the managed directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "rux-agent-data-")); roots.push(root);
    const legacyCodex = join(root, "legacy-codex");
    const legacyClaude = join(root, "legacy-claude");
    process.env.CODEX_HOME = legacyCodex;
    process.env.CLAUDE_CONFIG_DIR = legacyClaude;
    await mkdir(join(legacyCodex, "sessions", "2026", "08", "28"), { recursive: true });
    await writeFile(join(legacyCodex, "auth.json"), "auth");
    await writeFile(join(legacyCodex, "sessions", "2026", "08", "28", "rollout-native-codex.jsonl"), "codex");
    await writeFile(join(legacyCodex, "sessions", "2026", "08", "28", "rollout-unrelated.jsonl"), "other");
    await mkdir(join(legacyClaude, "projects", "project"), { recursive: true });
    await writeFile(join(legacyClaude, "projects", "project", "native-claude.jsonl"), "claude");

    const paths = agentDataPaths(join(root, "RUX"));
    await prepareAgentData(paths, {
      projects: [{ id: "project", name: "Project", path: "/tmp/project", threads: [{ id: "one", title: "Codex", agentId: "codex", nativeSessionId: "native-codex" }, { id: "two", title: "Claude", agentId: "claude-code", nativeSessionId: "native-claude" }] }],
      standaloneThreads: [],
    });

    expect(await readFile(join(paths.codexHome, "auth.json"), "utf8")).toBe("auth");
    expect(await readFile(join(paths.codexHome, "sessions", "2026", "08", "28", "rollout-native-codex.jsonl"), "utf8")).toBe("codex");
    expect(await readFile(join(paths.claudeHome, "projects", "project", "native-claude.jsonl"), "utf8")).toBe("claude");
    expect(await readFile(join(legacyCodex, "sessions", "2026", "08", "28", "rollout-unrelated.jsonl"), "utf8")).toBe("other");
  });
});
