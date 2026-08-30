import type { CodexSandboxMode } from "./codex-permissions";

const READ_ONLY_TOOLS = "read,grep,find,ls";

export function piPermissionArgs(mode: CodexSandboxMode): string[] {
  if (mode === "workspace-write") {
    throw new Error("Pi RPC 暂不支持逐次操作审批。请选择只读模式，或确认开启完整访问权限。");
  }
  if (mode === "read-only") return ["--no-extensions", "--tools", READ_ONLY_TOOLS];
  return [];
}
