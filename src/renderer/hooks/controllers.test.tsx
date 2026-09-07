// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuxApi } from "../../electron/preload";
import type { ActiveThread, AgentId, GitState } from "../types";
import type { MessageStore } from "../messages";
import { useGitController } from "./useGitController";
import { useAgentRuns } from "./useAgentRuns";
import { useTerminalController } from "./useTerminalController";
import { useWorkspaceTools } from "./useWorkspaceTools";
import { useWorkspaceController } from "./useWorkspaceController";

let root: Root;
let element: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount<P, T>(hook: (props: P) => T, initial: P) {
  let value: T;
  function Harness({ input }: { input: P }) { value = hook(input); return null; }
  const render = async (input: P) => { await act(async () => root.render(<Harness input={input} />)); };
  await render(initial);
  return { get value() { return value!; }, render };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const gitState = (branch: string, paths = ["a.ts", "b.ts"]): GitState => ({ branch, files: paths.map((path) => ({ path, plus: 1, minus: 0, status: "M", untracked: false, staged: false, unstaged: true })) });
function gitApi() { return { git: { status: vi.fn(async (id: string) => gitState(id)), branches: vi.fn(async () => ["main", "feature"]), diff: vi.fn(async ({ path }: { path: string }) => `diff ${path}`), compare: vi.fn(async () => gitState("main…feature")), compareDiff: vi.fn(async ({ path }: { path: string }) => `compare ${path}`), stage: vi.fn(async () => gitState("main")), switchBranch: vi.fn(async () => gitState("feature")) } }; }

describe("Git navigation concurrency", () => {
  it("ignores an old project's status and background refresh", async () => {
    const api = gitApi(); const old = deferred<GitState>(); api.git.status.mockImplementationOnce(() => old.promise);
    const h = await mount((id: string) => useGitController(api as unknown as RuxApi, id, vi.fn(), vi.fn()), "old" as string);
    await h.render("new"); await act(async () => old.resolve(gitState("old")));
    expect(h.value.gitState.branch).toBe("new");
    await act(async () => h.value.refreshGit("old"));
    expect(h.value.gitState.branch).toBe("new"); expect(api.git.status).toHaveBeenCalledTimes(2);
  });
  it("keeps the most recently selected diff when requests finish out of order", async () => {
    const api = gitApi(); const h = await mount(() => useGitController(api as unknown as RuxApi, "project", vi.fn(), vi.fn()), undefined);
    const slow = deferred<string>(); api.git.diff.mockImplementationOnce(() => slow.promise);
    await act(async () => { void h.value.selectDiff("a.ts"); });
    await act(async () => h.value.selectDiff("b.ts"));
    await act(async () => slow.resolve("stale a.ts"));
    expect(h.value.selectedFile).toBe("b.ts"); expect(h.value.diff).toBe("diff b.ts"); expect(h.value.diffLoading).toBe(false);
  });
  it("preserves branch comparison during background refresh and resets on navigation", async () => {
    const api = gitApi(); const h = await mount((id: string) => useGitController(api as unknown as RuxApi, id, vi.fn(), vi.fn()), "one" as string);
    await act(async () => h.value.compareBranch("main")); await act(async () => h.value.refreshGit());
    expect(h.value.comparisonBase).toBe("main"); expect(h.value.diff).toBe("compare a.ts");
    await h.render("two"); expect(h.value.comparisonBase).toBe(""); expect(h.value.diff).toBe("diff a.ts");
  });
  it("refreshes file differences after staging or switching branches", async () => {
    const api = gitApi(); const h = await mount(() => useGitController(api as unknown as RuxApi, "project", vi.fn(), vi.fn()), undefined);
    api.git.diff.mockResolvedValue("updated diff"); await act(async () => h.value.stage(["a.ts"]));
    expect(h.value.diff).toBe("updated diff"); expect(h.value.busy).toBe(false);
  });
  it("exposes errors and clears them on successful retry", async () => {
    const api = gitApi(); api.git.status.mockRejectedValueOnce(new Error("repository unavailable"));
    const h = await mount(() => useGitController(api as unknown as RuxApi, "project", vi.fn(), vi.fn()), undefined);
    expect(h.value.error).toContain("repository unavailable");
    await act(async () => h.value.refreshGit()); expect(h.value.error).toBe(""); expect(h.value.gitState.files).toHaveLength(2);
  });
});

function runApi() {
  let listener: (event: unknown) => void = () => {};
  return { emit: (event: unknown) => listener(event), agent: { onEvent: vi.fn((next: typeof listener) => { listener = next; return () => {}; }), start: vi.fn(async () => ({ threadId: "native", turnId: "turn" })), interrupt: vi.fn(), respondToApproval: vi.fn() }, projects: { addStandalone: vi.fn(async () => ({ id: "saved", title: "Task" })) }, threads: { update: vi.fn() } };
}
function runHook(api: ReturnType<typeof runApi>) {
  const notify = vi.fn(); const reloadWorkspace = vi.fn(async () => ({ projects: [], standaloneThreads: [] })); const refreshGit = vi.fn(async () => {});
  return () => {
    const [activeThread, setActiveThread] = useState<ActiveThread | null>({ id: "draft:standalone", title: "Task", type: "standalone", draft: true });
    const [messages, setMessages] = useState<MessageStore>({});
    const runs = useAgentRuns({ api: api as unknown as RuxApi, activeThread, selectedAgent: "codex", agentMode: "default", preference: { model: "m", reasoning: "high", serviceTier: null }, settings: { provider: "codex", serviceName: "Codex", model: "m", reasoning: "high", sandboxMode: "read-only" }, attachments: [], webSearch: false, agents: [{ id: "codex", name: "Codex", integrated: true }], setMessages, setAttachments: vi.fn(), setComposerValue: vi.fn(), setActiveThread, reloadWorkspace, refreshGit, notify });
    return { ...runs, activeThread, setActiveThread, messages };
  };
}
describe("Agent sends", () => {
  it("creates one thread for repeated send clicks during persistence", async () => {
    const api = runApi(); const pending = deferred<{ id: string; title: string }>(); api.projects.addStandalone.mockImplementation(() => pending.promise);
    const h = await mount(runHook(api), undefined);
    await act(async () => { void h.value.sendMessage("hello"); void h.value.sendMessage("hello"); });
    expect(api.projects.addStandalone).toHaveBeenCalledTimes(1); expect(h.value.sending).toBe(true);
    await act(async () => pending.resolve({ id: "saved", title: "Task" }));
    expect(api.agent.start).toHaveBeenCalledTimes(1); expect(h.value.messages.saved).toHaveLength(2);
  });
  it("does not steal focus back after navigating during thread creation", async () => {
    const api = runApi(); const pending = deferred<{ id: string; title: string }>(); api.projects.addStandalone.mockImplementation(() => pending.promise);
    const h = await mount(runHook(api), undefined);
    await act(async () => { void h.value.sendMessage("hello"); });
    await act(async () => h.value.setActiveThread({ id: "other", title: "Other", type: "standalone" }));
    await act(async () => pending.resolve({ id: "saved", title: "Task" }));
    expect(h.value.activeThread?.id).toBe("other"); expect(h.value.runningThreadIds.has("saved")).toBe(true);
  });
  it("releases the send lock when creating a thread fails", async () => {
    const api = runApi(); api.projects.addStandalone.mockRejectedValueOnce(new Error("disk full"));
    const h = await mount(runHook(api), undefined);
    await act(async () => h.value.sendMessage("hello")); expect(h.value.sending).toBe(false);
    await act(async () => h.value.sendMessage("retry")); expect(api.agent.start).toHaveBeenCalledTimes(1);
  });
  it("flushes all queued deltas before turn completion", async () => {
    const api = runApi(); const h = await mount(runHook(api), undefined);
    await act(async () => h.value.sendMessage("hello"));
    const runId = (api.agent.start.mock.calls as unknown as Array<[{ runId: string }]>)[0][0].runId;
    await act(async () => {
      for (let i = 0; i < 100; i++) api.emit({ runId, type: "text-delta", itemId: "text", delta: "x" });
      api.emit({ runId, type: "turn-completed", status: "completed" });
    });
    expect(h.value.messages.saved[1].parts?.[0].text).toBe("x".repeat(100)); expect(h.value.messages.saved[1].status).toBe("complete"); expect(h.value.sending).toBe(false);
  });
});

describe("terminal lifecycle", () => {
  it("serializes startup and input, clears old output, and retries failures", async () => {
    let emit: (data: string) => void = () => {};
    const started = deferred<void>();
    const api = { terminal: { start: vi.fn(() => started.promise), write: vi.fn(async () => {}), stop: vi.fn(async () => {}), resize: vi.fn(async () => {}), onData: (cb: typeof emit) => { emit = cb; return () => {}; } } };
    const error = vi.fn(); const committed = vi.fn();
    const h = await mount((project: string) => useTerminalController(api as unknown as RuxApi, project, committed, error), "one" as string);
    await act(async () => { void h.value.startTerminal(); h.value.writeTerminalInput("one"); });
    expect(api.terminal.write).not.toHaveBeenCalled();
    await act(async () => started.resolve()); expect(api.terminal.write).toHaveBeenCalledWith("one");
    await act(async () => { emit("old output"); }); await h.render("two");
    expect(h.value.terminalOutput).toHaveLength(0); expect(h.value.terminalOpen).toBe(false);
    api.terminal.start.mockRejectedValueOnce(new Error("failed to spawn"));
    await act(async () => h.value.startTerminal()); expect(h.value.terminalStarting).toBe(false); expect(h.value.terminalOpen).toBe(false);
    await act(async () => h.value.startTerminal()); expect(h.value.terminalOpen).toBe(true); expect(h.value.terminalOutput).toHaveLength(0);
  });
});

describe("workspace removal", () => {
  it("selects a new standalone draft after removing the last project", async () => {
    const project = { id: "project", name: "Demo", path: "/tmp/demo", threads: [{ id: "thread", title: "Task" }] };
    const api = { projects: { remove: vi.fn(async () => ({ workspace: { projects: [], standaloneThreads: [] } })) } };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const h = await mount(() => useWorkspaceController(api as unknown as RuxApi, vi.fn(), vi.fn(), vi.fn()), undefined);
    await act(async () => h.value.initializeWorkspace({ projects: [project], standaloneThreads: [] }, "/tmp"));
    await act(async () => h.value.removeProject(project));
    expect(h.value.activeThread?.type).toBe("standalone"); expect(h.value.activeThread?.draft).toBe(true);
  });
});

describe("side-chat scope isolation", () => {
  function fixture() {
    const runs = runApi();
    runs.agent.interrupt.mockResolvedValue({ interrupted: true });
    const api = { ...runs, terminal: { onData: () => () => {}, stop: vi.fn(async () => {}) }, files: { list: vi.fn(async () => []) }, git: { remote: vi.fn(async () => "") } };
    const notify = vi.fn(); const refresh = vi.fn(async () => {});
    const preference = { model: "m", reasoning: "high" as const, serviceTier: null };
    const settings = { provider: "codex" as const, serviceName: "Codex", model: "m", reasoning: "high" as const, sandboxMode: "read-only" as const, baseUrl: "", hasApiKey: false, uiFontSize: 14, allowConversationOverride: true, conversationSticky: true };
    return { api, hook: (agent: AgentId) => useWorkspaceTools(api as unknown as RuxApi, "same-project", agent, "default", preference, settings, refresh, notify) };
  }
  it("interrupts a late native startup after changing agents within the same project", async () => {
    const { api, hook } = fixture();
    const pending = deferred<{ threadId: string; turnId: string }>();
    api.agent.start.mockImplementationOnce(() => pending.promise);
    const h = await mount(hook, "codex" as AgentId);
    await act(async () => h.value.setSideValue("old task"));
    await act(async () => { void h.value.sendSideChat(); });
    await h.render("pi");
    await act(async () => pending.resolve({ threadId: "late-thread", turnId: "late-turn" }));
    expect(api.agent.interrupt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: "codex", threadId: "late-thread", turnId: "late-turn" }));
    expect(h.value.sideMessages).toEqual([]);
    expect(h.value.sideSending).toBe(false);
  });
  it("does not clear a newer approval when an earlier response finishes", async () => {
    const { api, hook } = fixture();
    const response = deferred<void>(); api.agent.respondToApproval.mockImplementationOnce(() => response.promise);
    const h = await mount(hook, "codex" as AgentId);
    await act(async () => h.value.setSideValue("task"));
    await act(async () => h.value.sendSideChat());
    const runId = (api.agent.start.mock.calls as unknown as Array<[{ runId: string }]>)[0][0].runId;
    await act(async () => api.emit({ runId, type: "approval-request", approval: { id: "old", title: "old approval" } }));
    await act(async () => { void h.value.respondToSideApproval("accept"); });
    await act(async () => api.emit({ runId, type: "approval-request", approval: { id: "new", title: "new approval" } }));
    await act(async () => response.resolve());
    expect(h.value.sideApproval?.id).toBe("new");
  });
});

it("discards buffered output from a failed terminal before retrying", async () => {
  vi.useFakeTimers();
  let emit: (data: string) => void = () => {};
  const api = { terminal: { start: vi.fn(async () => {}), resize: vi.fn(async () => {}), stop: vi.fn(async () => {}), onData: (cb: typeof emit) => { emit = cb; return () => {}; } } };
  api.terminal.start.mockImplementationOnce(async () => { emit("STALE_STARTUP_OUTPUT"); throw new Error("startup failed"); });
  const notify = vi.fn(); const committed = vi.fn();
  const h = await mount(() => useTerminalController(api as unknown as RuxApi, "project", committed, notify), undefined);
  await act(async () => h.value.startTerminal());
  await act(async () => h.value.startTerminal());
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(h.value.terminalOutput.map(chunk => chunk.data).join("")).not.toContain("STALE_STARTUP_OUTPUT");
});
