import { describe, expect, it } from "vitest";
import { messageExportText, persistentMessages, reduceStreamEvent, type RuxMessage } from "./messages";

const runningMessage = (): RuxMessage => ({ id: "assistant-1", role: "assistant", parts: [], status: "running" });

describe("canonical message reducer", () => {
  it("collects text deltas and completes a turn", () => {
    const streamed = reduceStreamEvent(runningMessage(), { type: "text-delta", itemId: "text-1", delta: "Hello" });
    const completed = reduceStreamEvent(streamed, { type: "turn-completed", status: "completed" });
    expect(completed.parts?.[0].text).toBe("Hello");
    expect(completed.status).toBe("complete");
  });

  it("labels Claude file approvals as file changes", () => {
    const message = reduceStreamEvent(runningMessage(), { type: "approval-request", itemId: "tool-1", approval: { id: "approval-1", method: "claude/canUseTool", toolName: "Edit" } });
    expect(message.parts?.[0].toolName).toBe("fileChange");
  });
});

describe("message persistence", () => {
  it("exports streamed assistant text", () => {
    expect(messageExportText({ id: "a", role: "assistant", parts: [{ type: "text", text: "answer" }] })).toBe("answer");
  });

  it("caps retained messages per thread", () => {
    const messages = Array.from({ length: 205 }, (_, index) => ({ id: String(index), role: "user" as const, parts: [{ type: "text", text: String(index) }] }));
    expect(persistentMessages({ thread: messages }).thread).toHaveLength(200);
  });
});
