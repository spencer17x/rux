import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateDatabase } from "./state-database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function database(): StateDatabase {
  const directory = mkdtempSync(join(tmpdir(), "rux-state-test-"));
  temporaryDirectories.push(directory);
  return new StateDatabase(join(directory, "state.sqlite"));
}

describe("StateDatabase", () => {
  it("round-trips projects, standalone threads, and native session metadata", () => {
    const state = database();
    state.saveWorkspace({
      projects: [{ id: "project-1", name: "Rux", path: "/tmp/rux", threads: [{ id: "thread-1", title: "Build", agentId: "codex", nativeSessionId: "native-1" }] }],
      standaloneThreads: [{ id: "thread-2", title: "Standalone", agentId: "pi" }],
    });
    expect(state.loadWorkspace()).toEqual({
      projects: [{ id: "project-1", name: "Rux", path: "/tmp/rux", threads: [{ id: "thread-1", title: "Build", agentId: "codex", nativeSessionId: "native-1" }] }],
      standaloneThreads: [{ id: "thread-2", title: "Standalone", agentId: "pi" }],
    });
    state.close();
  });

  it("persists transcripts and cascades them when a thread is removed", () => {
    const state = database();
    state.saveWorkspace({ projects: [], standaloneThreads: [{ id: "thread-1", title: "Chat" }] });
    state.saveMessages({ "thread-1": [{ id: "message-1", role: "user", text: "hello" }] });
    expect(state.loadMessages()["thread-1"]).toHaveLength(1);
    state.saveWorkspace({ projects: [], standaloneThreads: [] });
    expect(state.loadMessages()).toEqual({});
    state.close();
  });
});
