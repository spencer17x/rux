import { describe, expect, it } from "vitest";
import { adjacentStickyTurn, completedStickyTurns, messageExportText, normalizedMessages, persistentMessages, reduceStreamEvent, type RuxMessage } from "./messages";

const runningMessage = (): RuxMessage => ({ id: "assistant-1", role: "assistant", parts: [], status: "running" });

describe("canonical message reducer", () => {
  it("collects text deltas and completes a turn", () => {
    const streamed = reduceStreamEvent(runningMessage(), { type: "text-delta", itemId: "text-1", delta: "Hello" });
    const completed = reduceStreamEvent(streamed, { type: "turn-completed", status: "completed" });
    expect(completed.parts?.[0].text).toBe("Hello");
    expect(completed.status).toBe("complete");
    expect(completed.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps a user-stopped turn incomplete instead of marking it failed or complete", () => {
    const interrupted = reduceStreamEvent(runningMessage(), { type: "turn-completed", status: "interrupted" });
    expect(interrupted.status).toBe("incomplete");
  });

  it("labels Claude file approvals as file changes", () => {
    const message = reduceStreamEvent(runningMessage(), { type: "approval-request", itemId: "tool-1", approval: { id: "approval-1", method: "claude/canUseTool", toolName: "Edit" } });
    expect(message.parts?.[0].toolName).toBe("fileChange");
  });
});

describe("message persistence", () => {
  it("finds completed user turns for conversation sticky", () => {
    const messages = [{ id: "u1", role: "user", text: "First question" }, { id: "a1", role: "assistant", status: "complete", text: "Done" }, { id: "u2", role: "user", text: "Current question" }, { id: "a2", role: "assistant", status: "running", text: "" }] as RuxMessage[];
    expect(completedStickyTurns(messages)).toEqual([{ id: "u1", text: "First question" }]);
  });
  it("does not treat an incomplete historical turn as sticky-complete", () => {
    const messages = [{ id: "u1", role: "user", text: "Interrupted" }, { id: "a1", role: "assistant", status: "incomplete", text: "Partial" }] as RuxMessage[];
    expect(completedStickyTurns(messages)).toEqual([]);
  });
  it("moves between adjacent completed sticky turns without crossing either end", () => {
    const turns = [{ id: "one", text: "One" }, { id: "two", text: "Two" }, { id: "three", text: "Three" }];
    expect(adjacentStickyTurn(turns, "two", -1)).toEqual(turns[0]); expect(adjacentStickyTurn(turns, "two", 1)).toEqual(turns[2]); expect(adjacentStickyTurn(turns, "one", -1)).toBeNull(); expect(adjacentStickyTurn(turns, "three", 1)).toBeNull();
  });
  it("exports streamed assistant text", () => {
    expect(messageExportText({ id: "a", role: "assistant", parts: [{ type: "text", text: "answer" }] })).toBe("answer");
  });

  it("caps retained messages per thread", () => {
    const messages = Array.from({ length: 205 }, (_, index) => ({ id: String(index), role: "user" as const, parts: [{ type: "text", text: String(index) }] }));
    expect(persistentMessages({ thread: messages }).thread).toHaveLength(200);
  });

  it("normalizes raw text parts in persisted error messages", () => {
    const messages = normalizedMessages({ thread: [{ id: "a", role: "assistant", status: "error", error: "Agent 登录或凭据已失效，请前往设置重新登录或检查 Provider。", parts: [{ type: "text", text: "Failed to authenticate. API Error: 403 API Key 所属分组已删除", status: { type: "complete" } }] }] });
    expect(messages.thread[0].parts?.[0].text).toContain("凭据已失效");
  });

  it("normalizes legacy boolean error messages", () => {
    const messages = normalizedMessages({ thread: [{ id: "a", role: "assistant", text: "Not inside a trusted directory and --skip-git-repo-check was not specified.", error: true }] });
    expect(messages.thread[0].status).toBe("error");
    expect(messages.thread[0].error).toContain("Git 仓库");
  });
});
