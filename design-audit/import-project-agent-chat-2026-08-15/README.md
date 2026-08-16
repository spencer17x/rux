# 项目导入与 Coding Agent 对话验收

日期：2026-08-15

## 范围

从全新桌面状态验证以下链路：打开本地项目、显式检测本机 Agent、使用 Codex/ChatGPT OAuth 连接发送一条不读写文件的消息、观察 Run 与 Changes 证据。

## 结论

项目导入、Agent 检测和默认 Engine 模型对话均可用。修复后，Codex 真实对话无需手动指定模型即可成功，返回 `RUX_DEFAULT_OK`；Provider 报告的实际模型 `gpt-5.6-sol` 和 Token Usage 均正常持久化与展示。

对话中的文件卡已明确改为“工作区未提交”状态，并说明它可能包含 Run 开始前已有改动；本次 Run 的文件归属以 Run Evidence 为准，不再把 Workspace 全局状态描述成 Agent 本次编辑。

## 步骤

1. **全新启动 — 健康**：应用没有自动导入项目或检测登录态；需要用户点击“打开项目”。证据：`01-clean-start.png`。
2. **原生目录选择 — 健康**：入口打开 macOS 目录选择器，按钮与辅助功能名称均为“打开工作区”。证据：`02-native-project-picker.png`。
3. **项目导入 — 健康**：选择本地仓库后生成 Workspace starter Task，Composer 解锁，侧栏显示当前项目与分支。证据：`03-project-imported.png`。
4. **Agent 检测 — 健康**：只有显式点击“开始检测”后才检查 CLI；Codex 与 Claude Code 均显示已连接，且不展示凭据。证据：`06-agent-detected.png`。
5. **默认模型对话（修复前）— 阻断**：发送无工具测试消息后，Run 因模型决策与 Run 模型不一致而停止，任务状态保存失败。证据：`07-real-agent-reply.png`。
6. **显式模型对话（修复前）— 可用但有证据风险**：在高级设置指定 `gpt-5.6-sol` 后真实回复成功，并显示实际模型和 Token；但 Run 卡错误列出运行前的未跟踪文件。证据：`08-explicit-model-agent-reply.png`。
7. **默认模型对话（修复后）— 健康**：不打开高级模型设置，发送无工具测试消息后真实回复 `RUX_DEFAULT_OK`。Run 在 6 秒内完成，实际模型为 `gpt-5.6-sol`，显示 22,822 tokens，未出现持久化错误。Workspace 文件卡使用新的全局状态说明。证据：`10-default-model-fixed-final.png`。

## 代码定位

默认模型问题来自事件组合：固定模型决策在未提供模型时记录 `engine-default`，随后 Codex `run.metadata` 把 Run 模型更新为 Provider 返回的实际模型，最终触发 persisted Run schema 的一致性校验。

修复在 Renderer 和 Task Store 两层处理同一状态迁移：Renderer 收到 `run.metadata` 时同步解析 Model Decision；Task Store 仅允许一次由同一 Run 的持久化 Provider metadata 证明的 `engine-default` 到具体模型解析，并继续拒绝其他 Model Decision 改写。

## 自动化验证

在 `app/` 运行 `npm test`：退出码 0。类型检查、认证、Agent、适配器、权限、持久化、Runtime、Git、Sites 与 TUI 测试全部通过。新增测试覆盖 Renderer 的默认模型解析、Task Store 的一次性受证据约束解析，以及拒绝后续改写。

运行 `npm run package`：退出码 0。随后在隔离用户数据目录中启动实际的 macOS arm64 打包应用，完成项目打开、显式 Agent 检测和默认模型真实对话复验。

## 证据限制

- 本次只对 Codex 做了真实网络对话；Claude Code 仅确认官方 CLI 已连接，没有发送真实消息。
- 为避免修改用户项目，真实消息明确要求不调用工具、不读取或修改文件；“实现需求”的文件编辑能力由现有适配器、权限与 Git 自动化测试覆盖，本次没有在真实仓库执行写入任务。
- 截图不能证明完整键盘顺序、屏幕阅读器语义或 WCAG 合规性；只确认了关键按钮具有可读的辅助功能名称。
- macOS 打包产物仍未签名；分发前需要 Developer ID 签名与公证。
