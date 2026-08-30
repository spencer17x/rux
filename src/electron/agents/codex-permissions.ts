export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export function codexApprovalPolicy(mode: CodexSandboxMode): "untrusted" | "on-request" | "never" {
  if (mode === "danger-full-access") return "never";
  if (mode === "read-only") return "untrusted";
  return "on-request";
}

export function codexSandboxPolicy(input: { sandboxMode: CodexSandboxMode; cwd: string; webSearch?: boolean }): Record<string, unknown> {
  if (input.sandboxMode === "danger-full-access") return { type: "dangerFullAccess" };
  if (input.sandboxMode === "read-only") return { type: "readOnly", networkAccess: Boolean(input.webSearch) };
  return {
    type: "workspaceWrite",
    writableRoots: [input.cwd],
    networkAccess: Boolean(input.webSearch),
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export function codexBufferedPermissionArgs(mode: CodexSandboxMode, resuming: boolean): string[] {
  if (mode === "danger-full-access") return ["--dangerously-bypass-approvals-and-sandbox"];
  if (resuming) return ["-c", `sandbox_mode="${mode}"`, "-c", 'approval_policy="never"'];
  if (mode === "workspace-write") return ["--approve-for-me"];
  return ["-s", "read-only", "-c", 'approval_policy="never"'];
}
