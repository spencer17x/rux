import { describe, expect, it } from "vitest";
import { messageTargetFromHref } from "./message-targets";

describe("messageTargetFromHref", () => {
  it("recognizes HTTP links without a project", () => {
    expect(messageTargetFromHref("https://example.com/docs")).toEqual({ kind: "link", url: "https://example.com/docs" });
  });

  it("binds relative and absolute file links to the active project", () => {
    expect(messageTargetFromHref("src/App.tsx#L12", "project")).toEqual({ kind: "file", projectId: "project", path: "src/App.tsx#L12" });
    expect(messageTargetFromHref("/tmp/project/src/App.tsx", "project")?.kind).toBe("file");
  });

  it("does not elevate unsupported schemes or standalone paths", () => {
    expect(messageTargetFromHref("javascript:alert(1)", "project")).toBeNull();
    expect(messageTargetFromHref("src/App.tsx")).toBeNull();
  });
});
