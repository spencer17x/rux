import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./codex-app-server";
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

describe("Codex composer settings", () => {
  it("explicitly resets search and collaboration mode on a resumed conversation", async () => {
    const client = new CodexAppServerClient(() => "codex", vi.fn()) as any;
    client.ensureStarted = vi.fn(async () => {});
    client.request = vi.fn(async (method: string) => method === "turn/start" ? { turn: { id: "turn" } } : { thread: { id: "thread" }, model: "gpt-6-astra" });
    const input = { runId: "run", cwd: "/project", model: "gpt-6-astra", prompt: "hello", sandboxMode: "read-only", reasoning: "medium" };
    await client.startTurn({ ...input, mode: "plan", webSearch: true, serviceTier: "priority" });
    await client.startTurn({ ...input, runId: "next", threadId: "thread", mode: "default", webSearch: false, serviceTier: null });
    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread", config: { web_search: "disabled" }, serviceTier: null }));
    const turns = client.request.mock.calls.filter(([method]: string[]) => method === "turn/start").map(([, params]: any[]) => params);
    expect(turns[0]).toMatchObject({ collaborationMode: { mode: "plan" }, serviceTier: "priority", sandboxPolicy: { networkAccess: true } });
    expect(turns[1]).toMatchObject({ collaborationMode: { mode: "default", settings: { model: "gpt-6-astra", reasoning_effort: "medium", developer_instructions: null } }, serviceTier: null, sandboxPolicy: { networkAccess: false } });
  });
});
