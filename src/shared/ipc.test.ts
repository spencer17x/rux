import { describe, expect, it } from "vitest";
import { agentStartSchema, externalUrlSchema, projectFileSchema } from "./ipc";

describe("IPC schemas", () => {
  it("accepts a bounded agent request", () => {
    expect(agentStartSchema.parse({ runId: "run-1", prompt: "hello", agentId: "codex" }).prompt).toBe("hello");
    expect(agentStartSchema.parse({ runId: "run-2", prompt: "fast", agentId: "codex", serviceTier: "priority" }).serviceTier).toBe("priority");
    expect(agentStartSchema.parse({ runId: "run-3", prompt: "standard", agentId: "codex", serviceTier: null }).serviceTier).toBeNull();
  });

  it("rejects unknown agents and invalid file paths", () => {
    expect(() => agentStartSchema.parse({ runId: "run-1", prompt: "hello", agentId: "unknown" })).toThrow();
    expect(() => projectFileSchema.parse({ projectId: "project", path: "bad\0path" })).toThrow();
  });

  it("only permits HTTP(S) external URLs", () => {
    expect(externalUrlSchema.parse("https://example.com")).toBe("https://example.com");
    expect(() => externalUrlSchema.parse("file:///tmp/secret")).toThrow();
  });
});
