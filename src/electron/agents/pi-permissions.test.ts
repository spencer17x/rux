import { describe, expect, it } from "vitest";
import { piPermissionArgs } from "./pi-permissions";

describe("Pi permission mapping", () => {
  it("removes command and write tools in read-only mode", () => {
    expect(piPermissionArgs("read-only")).toEqual(["--no-extensions", "--tools", "read,grep,find,ls"]);
  });

  it("rejects the approval mode Pi cannot enforce", () => {
    expect(() => piPermissionArgs("workspace-write")).toThrow("Pi RPC 暂不支持逐次操作审批");
  });

  it("only leaves Pi unrestricted after full-access confirmation", () => {
    expect(piPermissionArgs("danger-full-access")).toEqual([]);
  });
});
