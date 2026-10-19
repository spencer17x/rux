export type SettingsSearchEntry = {
  section: string;
  label: string;
  keywords: string;
};

// Section titles alone are too coarse: users search for "字体", "API key" or
// "提交". Each entry maps a concrete setting to the section that owns it.
export const settingsSearchIndex: SettingsSearchEntry[] = [
  { section: "general", label: "登录账户", keywords: "账户 登录 邮箱 套餐 计划 plan email" },
  { section: "general", label: "项目数量", keywords: "项目 工作区 当前项目 project" },
  { section: "general", label: "对话 Sticky", keywords: "对话 置顶 上一轮问题 滚动 sticky" },
  { section: "agents", label: "自动同步 Agent 配置", keywords: "agent 配置 同步 导入 ~/.rux" },
  { section: "agents", label: "配置更新时询问", keywords: "agent 配置 更新 询问 导入" },
  { section: "agents", label: "底座 Agent 状态", keywords: "agent codex claude pi 版本 下载 登录" },
  { section: "providers", label: "Provider API key", keywords: "provider api key 密钥 凭据 安全存储" },
  { section: "providers", label: "Base URL 与 Headers", keywords: "base url headers 协议 自定义 服务地址" },
  { section: "providers", label: "Provider 模型列表", keywords: "模型 model 推理等级 输入类型 图片" },
  { section: "appearance", label: "主题", keywords: "主题 外观 深色 浅色 颜色 theme" },
  { section: "appearance", label: "UI 字号", keywords: "字体 字号 大小 font size 缩放" },
  { section: "permissions", label: "默认权限", keywords: "权限 沙盒 批准 只读 sandbox 审批" },
  { section: "permissions", label: "完整访问", keywords: "完整访问 危险 跳过 批准 full access" },
  { section: "models", label: "GPT OAuth 登录", keywords: "codex 登录 退出登录 退出 oauth 账户 gpt 授权" },
  { section: "models", label: "连接方式", keywords: "连接 自定义服务 base url api key 协议" },
  { section: "models", label: "默认模型", keywords: "模型 默认 model 推理 思考程度 reasoning" },
  { section: "shortcuts", label: "键盘快捷键", keywords: "快捷键 键盘 键位 命令 shortcut" },
  { section: "git", label: "当前仓库", keywords: "git 仓库 分支 变更 提交 commit 远程 remote" },
  { section: "environment", label: "运行环境", keywords: "环境 版本 electron chromium 平台 架构" },
];

export function matchSettings(query: string): SettingsSearchEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return settingsSearchIndex.filter((entry) => `${entry.label} ${entry.keywords}`.toLocaleLowerCase().includes(needle));
}
