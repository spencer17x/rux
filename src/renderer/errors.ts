export function userFacingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/请求参数无效|Too small|expected string/i.test(raw)) return "会话参数无效，请新建会话后重试。";
  if (/未登录|login/i.test(raw)) return "Agent 尚未登录，请前往设置完成登录后重试。";
  if (/操作超时|timed? out|timeout/i.test(raw)) return "操作超时，请检查网络或运行时状态后重试。";
  if (/终端未启动/i.test(raw)) return "终端尚未准备好，请重新打开终端后重试。";
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "").replace(/^Error:\s*/i, "") || "操作失败，请重试。";
}
