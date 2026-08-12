# P0-E4 Native Session 恢复桌面验收

> 日期：2026-08-12
>
> 产物：`app/release/mac-arm64/Rux.app`（未签名本地包）
>
> 视口：1356 × 768，实际打包 Electron 应用

## 验收范围

- Codex Thread 与 Claude Session 统一保存为规范化 Native Session Link。
- 同一 Task 只有在 Engine、Connection、Agent Revision 与 Workspace 全部匹配时才恢复原 Session。
- Native Session 恢复失败不静默创建替代会话；界面保留错误与原生标识，并只提供重试原 Session 或创建新 Task。
- Run 检查器可回看实际 Engine、Revision、Connection、模型状态、Permission 和 Session。
- 创建新 Task 时不继承消息、Run、Context 或 Native Session Link，只把失败 Run 的用户提示词放回未发送的 Composer 草稿。

## 稳定证据

| 场景 | 结果 | 截图 |
| --- | --- | --- |
| Codex Thread 恢复失败 | Task 顶部显示失败原因与 `thread-missing-demo`，明确说明没有自动创建替代会话；“重试原 Session”和“创建新任务”均有可见文案与 accessible name | [恢复失败分支](p0-e4-session-recovery.png) |
| 打开失败 Run 的检查器 | Engine、Revision、Connection、模型来源/验证状态、Permission、Codex Thread 与 `run.failed` 事件同时可见；无结构化验证时明确不显示测试通过 | [Run 与 Session 证据](p0-e4-run-session-evidence.png) |

## 数据与自动化核对

- 隔离 SQLite 中，点击“创建新任务”后原 Task 保持 1 条消息和 1 个失败 Run；新 Task 的消息数和 Run 数均为 0，未继承 Session Link。
- Codex App Server Fake 覆盖 `thread/resume` 失败，断言不会继续调用 `thread/start`。
- Claude Fake 覆盖带原 Session ID 的恢复启动事件。
- Session 合同测试覆盖四维兼容判断、忽略更新但不兼容的 Link、失败证据持久化，以及跨 Connection、Revision、Workspace Link 的拒绝。
- 重启孤儿 Run、Workspace 切换处置 Runtime/PTY/Run 与 Terminal 不自动恢复沿用既有生命周期测试。
- 验收使用隔离用户数据目录，没有执行真实 Run、OAuth、登录状态检测或凭据操作。

结论：P0-E4 的 Native Session Link、兼容恢复、显式失败分支和 Run 可审查证据通过最终打包桌面验收。
