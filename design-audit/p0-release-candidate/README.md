# P0 Desktop 发布候选验收

> 日期：2026-08-12
>
> 产物：`app/release/mac-arm64/Rux.app`（未签名本地包）
>
> 平台：macOS arm64
>
> 实际捕获视口：1356 × 768（小于产品基准 1433 × 812，关键路径无裁切）
>
> 测试 Workspace：两个隔离临时 Git 仓库 `workspace-a` 与 `workspace-b`

## 用户目标与范围

用户从一个干净的打包应用启动，不需要 Rux 云账号；在明确动作后检测本机 Agent，选择现有 Rux Agent 与 Engine 默认模型，完成首次 Run，重启应用后继续同一 Native Session，再切换 Workspace 并确认旧 Runtime 与 Terminal 状态不会泄漏到新项目。

## 流程与结果

| Step | 场景 | 健康度 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 干净启动 | 健康 | 只显示授权的测试 Workspace、空白 Task 与禁用发送；没有 Showcase、假账号或自动检测结果 | [01-clean-start.png](01-clean-start.png) |
| 2 | 打开 Agent 与 Provider | 健康 | Rux 与 Claude Code 均为“未检测”；页面明确无需 Rux 账号、不会读取凭据文件 | [02-agent-undetected.png](02-agent-undetected.png) |
| 3 | 用户点击检测 | 健康 | Fake Codex 以 CLI API Key 连接，Fake Claude 以 OAuth 连接；版本、路径和非敏感状态分开显示 | [03-agent-detected.png](03-agent-detected.png) |
| 4 | 首次 Run | 健康 | Engine 默认解析为 `fake-model`，Run 完成并持久化；Starter Task 自动采用首条提示词作为可识别标题 | [04-first-run-complete.png](04-first-run-complete.png) |
| 5 | Run 证据 | 健康 | Revision、Connection、模型状态、Permission、Codex Thread、Context Snapshot、Git 基线、验证和事件均可回看 | [05-run-evidence.png](05-run-evidence.png) |
| 6 | 重启与续聊 | 健康 | Task 与首个 Run 重启后保留，Terminal 不自动恢复；再次显式检测后产生 Run #2，并恢复同一个 `thread-runtime-1` | [06-restart-resume.png](06-restart-resume.png) |
| 7 | 切换 Workspace | 健康 | 原 Task 留在 `workspace-a`，`workspace-b` 获得独立空白 Task；新 Workspace 没有旧 Terminal、Run 或 Session 状态 | [07-workspace-switch.png](07-workspace-switch.png) |

## 自动化与数据证据

- Fake App Server Transcript 只有一次 `thread/start`，重启后的第二次 Run 使用 `thread/resume(thread-runtime-1)`；没有静默分叉。
- Workspace A 的 SQLite 快照包含两个 Run，两个规范化 Session Link 都指向 `thread-runtime-1`；Workspace B 独立为 0 Run。
- QA 进程注入了仅由 Fake CLI 消费的 Base URL 和测试 API Key。对隔离用户数据目录做二进制文本扫描，未发现 Base URL 或测试 Key。
- 未触发真实 OAuth、真实 CLI 登录、真实用户会话读取或外部网络请求。
- `npm test` 覆盖协议、迁移、认证、Revision、模型、Session、权限、Runtime 生命周期、Web 与 TUI；构建与打包命令单独执行。

## UX 与可访问性结论

### 已确认优势

- Workspace、账户、Agent、模型、Permission 和 Run 证据的入口均使用可见文字，没有把关键动作藏在无标签图标中。
- 未检测、已连接、运行完成、重启恢复和 Workspace 切换具有清楚且不矛盾的状态文案。
- 重要控件在 macOS Accessibility Tree 中同时具备可见文案或 accessible name，包括“开始检测”“发送”“打开环境面板”“重试原 Session”“打开项目…”和任务操作。
- 在 1356 × 768 的保守桌面视口中，连接面板、Composer、任务历史和错误/完成状态均可操作；因此更大的 1433 × 812 产品基准不构成更紧的布局约束。

### 已知限制与风险

- 为遵守“不得后台检查 CLI”的产品边界，应用重启后用户需要再次点击检测才能继续 Run；这是安全与便利之间的显式取舍。
- macOS 包未签名、未公证，只适合本地验收，不可描述为可公开分发的正式版本。
- 截图与 Accessibility Tree 不能证明完整键盘遍历、焦点顺序、屏幕阅读器播报或 WCAG 全面合规；这些仍需专项辅助技术测试。
- QA 使用 Fake CLI，证明的是桌面边界、协议与恢复路径；真实 OAuth 及真实账号 Run 不在例行验收范围内。

## 结论

P0 功能、自动化、构建、打包、桌面主路径、安全负向检查与证据门禁均通过。当前产物可作为未签名的本地 P0 Release Candidate；对外分发仍被 Developer ID 签名与公证阻断。
