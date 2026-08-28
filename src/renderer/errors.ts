export function userFacingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/请求参数无效|Too small|expected string/i.test(raw)) return "会话参数无效，请新建会话后重试。";
  if (/未登录|login|authenticat|API Key.*(?:删除|失效)|\b403\b/i.test(raw)) return "Agent 登录或凭据已失效，请前往设置重新登录或检查 Provider。";
  if (/fetch failed|network error|ECONNREFUSED|连接被拒绝/i.test(raw)) return "连接失败，请检查服务地址、网络以及本地服务是否已启动。";
  if (/Not inside a trusted directory|skip-git-repo-check/i.test(raw)) return "当前目录未被 Agent 信任，请初始化 Git 仓库或检查项目配置后重试。";
  if (/操作超时|timed? out|timeout/i.test(raw)) return "操作超时，请检查网络或运行时状态后重试。";
  if (/终端未启动/i.test(raw)) return "终端尚未准备好，请重新打开终端后重试。";
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "").replace(/^Error:\s*/i, "") || "操作失败，请重试。";
}
