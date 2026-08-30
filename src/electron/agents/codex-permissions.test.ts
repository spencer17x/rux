import { describe, expect, it } from "vitest";
import { codexApprovalPolicy, codexBufferedPermissionArgs, codexSandboxPolicy } from "./codex-permissions";

describe("Codex permission mapping", () => {
  it("keeps read-only turns untrusted and denies workspace writes", () => {
    expect(codexApprovalPolicy("read-only")).toBe("untrusted");
    expect(codexSandboxPolicy({ sandboxMode: "read-only", cwd: "/project" })).toEqual({
      type: "readOnly",
      networkAccess: false,
    });
  });

  it("scopes workspace-write turns to the active project", () => {
    expect(codexApprovalPolicy("workspace-write")).toBe("on-request");
    expect(codexSandboxPolicy({ sandboxMode: "workspace-write", cwd: "/project", webSearch: true })).toEqual({
      type: "workspaceWrite",
      writableRoots: ["/project"],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
  });

  it("only removes approval and sandbox limits for explicit full access", () => {
    expect(codexApprovalPolicy("danger-full-access")).toBe("never");
    expect(codexSandboxPolicy({ sandboxMode: "danger-full-access", cwd: "/project", webSearch: true })).toEqual({
      type: "dangerFullAccess",
    });
  });

  it("keeps buffered side conversations read-only without waiting for an unavailable approval UI", () => {
    expect(codexBufferedPermissionArgs("read-only", false)).toEqual(["-s", "read-only", "-c", 'approval_policy="never"']);
    expect(codexBufferedPermissionArgs("read-only", true)).toEqual(["-c", 'sandbox_mode="read-only"', "-c", 'approval_policy="never"']);
  });

  it("does not silently widen resumed buffered conversations", () => {
    expect(codexBufferedPermissionArgs("workspace-write", false)).toEqual(["--approve-for-me"]);
    expect(codexBufferedPermissionArgs("workspace-write", true)).toEqual(["-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"']);
    expect(codexBufferedPermissionArgs("danger-full-access", true)).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
  });
});
