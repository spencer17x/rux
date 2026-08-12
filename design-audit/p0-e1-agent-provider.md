# P0-E1 Agent 与 Provider 桌面验收

> 日期：2026-08-12
>
> 产物：`app/release/mac-arm64/Rux.app`（未签名本地包）
>
> 视口：1356 × 768，实际打包 Electron 应用

## 验收范围

- 从侧栏底部可见的“账户与登录”进入“Agent 与 Provider”。
- 打开应用和打开连接面板时均保持“未检测”；只有点击“开始检测”才读取 CLI 安装、版本和非敏感连接状态。
- Rux 与 Claude Code 独立展示未安装、已安装未连接、已连接和检测错误，并提供与状态匹配的恢复动作。
- API Key、Base URL、云 Provider 和 OAuth 凭据继续由官方 CLI 持有；Renderer 只展示非敏感状态及 Connection 引用。

## 稳定证据

| 场景 | 结果 | 截图 |
| --- | --- | --- |
| Rux 通过 CLI API Key 连接；Claude Code 已安装但未连接 | 两个 Engine 状态与动作相互独立；Claude 显示官方登录动作，Rux 可改用 OAuth | [检测结果](p0-e1-agent-provider-detected.png) |
| Codex 与 Claude CLI 均不存在 | 两行均显示“未安装”，分别链接到对应官方安装说明，不执行静默安装 | [未安装](p0-e1-agent-provider-not-installed.png) |
| Rux 状态命令返回异常；Claude CLI 不存在 | Rux 显示“检测错误”和行内“重新检测”，Claude 仍保持独立的未安装恢复动作 | [检测错误](p0-e1-agent-provider-error.png) |

## 验收说明

- 连接与未连接场景使用仓库内 Fake Codex/Fake Claude CLI；缺失场景使用不可解析的隔离路径；错误场景使用会对状态参数返回非零状态的受控本机可执行文件。
- 通过可访问性树同时核对了“账户与登录”“开始/重新检测”“官方安装说明”“使用 Claude 登录”等可见文案与 accessible name。
- 没有点击 OAuth 登录动作，没有读取或修改开发者真实 Codex/Claude 登录态。
- 所有临时用户数据目录在验收后移动到 macOS 废纸篓，可恢复。

结论：P0-E1 连接入口的最终打包桌面路径通过验收。
