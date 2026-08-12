# P0-E2 Agent Revision 桌面验收

> 日期：2026-08-12
>
> 产物：`app/release/mac-arm64/Rux.app`（未签名本地包）
>
> 视口：1356 × 768，实际打包 Electron 应用

## 验收范围

- Agent 编辑明确展示当前 Revision，并在保存前说明会追加新 Revision。
- 已固定旧 Revision 的 Task 检测到最新版时显示非阻塞提示，不自动修改 Task。
- “使用新版创建新任务”只创建一个空白 Task，固定最新版 Revision；不复制旧消息、Run、Context 或 Native Session。
- 原 Task、旧 Revision 和历史内容继续保留并可选择。
- 删除 Agent Definition 后，Runtime 仍可解析和执行保留的历史 Revision。

## 稳定证据

| 场景 | 结果 | 截图 |
| --- | --- | --- |
| Review Specialist 已从 Revision 1 更新至 Revision 2 | 旧 Task 顶部显示克制的版本提示，明确继续固定 Revision 1；未检测 Provider 时升级按钮禁用，检测完成后可用 | [旧任务版本提示](p0-e2-agent-revision-update.png) |
| 点击“使用新版创建新任务” | 新 Task 固定 Revision 2，Composer 为空；侧栏同时保留 Revision 2 新任务与原历史任务 | [新版空白任务](p0-e2-agent-revision-new-task.png) |
| 编辑当前 Agent Definition | 列表显示 Revision 2，保存说明明确将创建 Revision 3，既有任务继续固定原 Revision | [Agent 编辑器](p0-e2-agent-revision-editor.png) |

## 数据核对

最终 SQLite 状态包含两个独立 Task：

- 原 Task：`agent-revision:custom-00000000-0000-4000-8000-000000000042@1`，保留 2 条消息和 `README.md` Context。
- 新 Task：`agent-revision:custom-00000000-0000-4000-8000-000000000042@2`，消息、Run 与 Context 均为空。

Runtime Host 自动化还覆盖了 Definition 创建 Revision 1、更新为 Revision 2、删除 Definition 后分别运行两个保留 Revision；两次 Run 均读取对应版本的不可变指令和权限。

结论：P0-E2 的不可变 Revision、Task 固定和显式升级分支通过最终打包桌面验收。
