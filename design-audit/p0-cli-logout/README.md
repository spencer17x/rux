# Official CLI Logout QA

日期：2026-08-17

## 范围

- 使用实际 `release/mac-arm64/Rux.app` 的隔离 Bundle 和独立 `--user-data-dir`。
- `CODEX_CLI_PATH` 与 `CLAUDE_CODE_PATH` 指向只记录命令的假 CLI；未读取或修改开发者真实登录状态。
- 显式点击“开始检测”，验证已连接状态、退出入口和最终动作前的确认门。

## 结果

- 只有检测为已连接的 Codex/Claude Code Provider 显示 `退出登录`。
- Codex 和 Claude Code 的退出入口均具有可访问名称。
- 点击 Codex `退出登录` 后显示影响确认：官方 CLI 将删除其持有的认证凭据，已有 Task/历史保留，重新登录前不能运行。
- 验收在确认框选择 `Cancel`，没有执行退出命令。
- 假 CLI 自动化测试分别证明只调用 `codex logout` 与 `claude auth logout`，失败时不运行状态检查或另一 Engine。

## 证据

- `01-connected-logout-actions.png`：两个已连接 Provider 的退出入口。
- `02-logout-confirmation.png`：执行官方 CLI logout 前的确认框。
