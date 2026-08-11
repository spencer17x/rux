# RUX 发布候选证据 · 2026-08-10—11

> 结论：当前代码达到 **Desktop + TUI 本机开发内测里程碑**，不达到公开发布门槛。本文只记录本轮实际执行和观察到的证据；未覆盖项不推断为通过。

逐功能的闭环/部分/未实现判定与最新截图见 [`ux-audit-2026-08-11/full-functional-closure-audit.md`](./ux-audit-2026-08-11/full-functional-closure-audit.md)。

## 构建身份

| 字段 | 值 |
| --- | --- |
| 日期 / 时区 | 2026-08-10—11 / Asia/Shanghai |
| 平台 | macOS 26.5.2 (25F84), arm64 |
| 应用版本 | 0.1.0 |
| 基础 commit | `0d6b010f81648c9fe31a9d8eff34ed96ad65719c` |
| 工作树 | 有未提交实现；本产物不能声称由该 commit 单独复现 |
| 应用包 | `app/release/mac-arm64/RUX.app` |
| 签名 | ad-hoc，`Identifier=Electron`，无 Team ID |

## 自动化结果

在 `/Users/17a/projects/rux/app` 执行：

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm test` | 通过 | Typecheck；4 Auth；6 Task Store；5 Agent Profile；7 Codex Adapter/Parser；1 Standalone Host；11 Git；4 Sites；17 TUI unit；1 TUI integration，共 56 tests |
| `npm run build` | 通过 | Web、Electron Main/Preload/Renderer、Standalone Runtime Host、Rust release TUI |
| `npm run package` | 通过 | macOS arm64 `.app`；唯一预期警告是没有 Developer ID identity |
| `cargo clippy --all-targets -- -D warnings` | 通过（由 `npm test` 执行） | Rust TUI 所有 target |
| `cargo fmt -- --check` | 通过（由 `npm test` 执行） | Rust 格式 |

## 产物完整性

| 产物 | SHA-256 |
| --- | --- |
| `RUX.app/Contents/Resources/app.asar` | `0176abd543beccb2487db130923156e5f16d7b49b8e8c1ac5d6baa5576480276` |
| `RUX.app/Contents/Resources/runtime-host/rux-runtime.mjs` | `3670bb1526170bc48ff8bd2c34ea624d2361bd75b1162a788891764e54272fad` |
| `RUX.app/Contents/Resources/bin/rux-tui` | `ddbe7d3946400fb4e61ef6c267ddcefe14abfdbcdf8d6fa427e538f5fcfe0154` |

包内 TUI 是 ARM64 Mach-O，可执行权限存在，并与 `tui/target/release/rux-tui` 的 SHA-256 完全一致。`--help` 从包内路径成功执行。

## 实机主路径证据

### Desktop

- 使用隔离 `userData` 启动打包应用时，未授权 Workspace 显示“选择项目”，Composer/Agent/Model/Permission 不允许伪运行。
- 项目标题点击只改变展开/收起状态，不再切换项目；Task 点击才激活所属 Workspace。
- 在隔离 state 上用最新打包应用完成 Task 重命名、置顶、取消置顶语义、归档、展开归档区与重新打开；每个 Workspace 最后一个未归档 Task 的归档动作会禁用并显示原因。退出并重启同一包后，重命名、置顶/归档结果与选中 Task 均从 SQLite 恢复。截图与逐步审计见 [`ux-audit-2026-08-11/task-lifecycle-audit.md`](./ux-audit-2026-08-11/task-lifecycle-audit.md)。
- 生产新建 Task 的 Agent 菜单只列出 Claude Code 与 Codex，没有 RUX Demo/mock。
- Changes 面板读取当前仓库真实 95 个文件；文件列表、Diff 和审查动作可见。
- 点击 Accept 后显示“已记录本次审查；Git index 和工作区未被修改”。前后 Git status hash 都是 `5d84da97e0b02245b94d4e5edf5edecddd2d437f134bbd4651731d06f8580fec`，SQLite 中保存 review-only acceptance。
- 使用同一个隔离 state root 打开 TUI 创建的 Task 后，Desktop 显示相同的用户消息、助手消息、Codex/default/plan 与 Run history。
- 最终 hash 对应打包版的隔离 UI fixture 同时显示三种不同事实：`2 项验证证据`、`Run changed 2 files` 与 `Workspace currently changed 109 files`，没有把 Workspace 总改动冒充为某次 Run 结果。Run Inspector 展示不可变 Context hash/内容入口、baseline/after/snapshot tree、Run-owned 文件统计，以及 test/build 的 command、cwd、exit code、时间和日志入口。退出并重启同一包后四类 Run 证据仍存在。该 fixture 只证明 Renderer/SQLite/打包应用链路；Runtime 生成事实由下方自动化证明。截图见 [`08-final-timeline-evidence.png`](./ux-audit-2026-08-11/08-final-timeline-evidence.png)、[`09-final-run-inspector.png`](./ux-audit-2026-08-11/09-final-run-inspector.png) 和 [`10-final-restart-persistence.png`](./ux-audit-2026-08-11/10-final-restart-persistence.png)。

### Runtime / persistence

- 真实 Codex plan Run 返回预期内容；第二个 turn 使用同一个 external session ID 续聊成功。
- 打包应用重启后 Task、Message、Run 和 events 保留。人工注入的遗留 `running` 在下次加载时变为 Task `stopped` / Run `interrupted`，没有伪装仍在执行。
- 同一 Task 启动新 Run 和 Workspace 切换时，旧 Run 会持久化为明确终态，不被新 Run 覆盖。
- 两个独立 `TaskStore` 连接先后保存从同一旧版本分叉的 Desktop/TUI Snapshot 后，三条 Message、碰撞 sequence 的三条 Run Event 与 review acceptance 全部保留；重复保存陈旧 Snapshot 仍保持 3 条 Event，证明 merge 幂等。读取与合并发生在 `BEGIN IMMEDIATE` 内，并配置 5 秒 SQLite busy timeout。
- 自定义 Agent 启动时，Runtime 在真实 `run.started` 后发出包含名称、底座、模型、Instructions、Permission、Skill/Tool IDs 和时间戳的 `run.agent-snapshot`；Standalone Host、TUI persistence 和 SQLite reopen tests 均验证该 Snapshot，Desktop Run Inspector 可审查，后续 Profile 编辑/删除不会改写历史 Run。
- Runtime 在 Run 启动时从受权 Workspace 重新读取 AGENTS 与选中文件，流式计算 SHA-256，并拒绝 traversal/symlink escape；Standalone Host 测试证明同一个 immutable Context Snapshot 被发出、写入 Run、并把 AGENTS sentinel 与自定义 Agent Instructions 一起注入实际 Codex stdin prompt。
- Run 开始前使用独立临时 `GIT_INDEX_FILE` 从 HEAD/empty tree 构造 Workspace baseline，终态前再次构造 tree 并发出 `run.git-patch`。Git fixture 证明真实 index/cached diff 不变、运行前 staged/unstaged/untracked 改动不归给 Agent、ignored 文件排除、子目录 Workspace 不越界；Host 测试证明 `run.git-patch` 一定先于 `run.completed` 到达客户端。
- Codex command execution 现在产生带 command/cwd/time/exit/log 的结构化 Verification；secret 会脱敏、长日志会截断。Claude Code 无法提供确切 exit code 的 Bash 结果保持 `unknown`，不会伪造通过。SQLite、Desktop 与 TUI 都保存这类证据。

### TUI

- 包内 `Resources/bin/rux-tui` 未传 `--node`/`--runtime-host` 时，自动定位包内 Electron Node runner 与 Runtime Host，界面稳定显示 `LIVE JSONL · CONNECTED`。
- Runtime Host 在 `runtime.ready` 广播 protocol v1；TUI 协商前显示 `NEGOTIATING`，匹配后显示 `CONNECTED · v1`，missing/mismatch 会显示错误并阻止 Run，自动化覆盖 mismatch。
- 在 80×24 PTY 中执行 `/changes`，读取同一真实仓库的 95 个文件和 `+25493 -23` 统计；`Ctrl+Q` 退出码为 0，并恢复 alternate screen/cursor。
- 真实 Codex Prompt → streamed activity/message → completed；第二轮沿用 external session，TUI restart 后恢复上一 Task/Messages/Run。
- `/context` 返回真实 AGENTS.md、selected files 和 capability 摘要；`/accept` 写入 review-only acceptance 且 Git hash 不变。
- TUI 已保存并显示 immutable Context、Run Git baseline/patch 与 Verification summary；协议 mismatch 仍会阻止 Run，不会把未知事件伪装为完成。
- Restore 没有在真实工作树执行。自动化只验证 preview → 精确同路径 confirm → snapshot guard 请求；破坏性 E2E 必须在 fixture repository 完成。

## 当前 Gate 判定

| Gate | 判定 | 原因 |
| --- | --- | --- |
| Gate A · 事实与数据完整性 | 未通过 | Verification、Run-owned baseline/patch 与 immutable Context 已进入协议和 Store；Migration、Permission/Checkpoint/Artifact snapshots 仍不足 |
| Gate B · Desktop 内部 Alpha | 部分 | 真实 Agent/Git/Context/Verification/Stop/Restart 可用；blocking Permission、Run-owned Restore、fixture destructive E2E 和核心 no-op inventory 未完全验收 |
| Gate C · Desktop 私测/Beta | 未通过 | 缺完整 Claude/Codex/Custom packaged E2E、键盘/VoiceOver、崩溃/长 Run/大 Diff证据 |
| Gate D · macOS 公开发布 | 未通过 | 无 Developer ID、Hardened Runtime 审计、公证、Stapling、Gatekeeper/干净机安装 |
| Gate E · 完整 RUX v1 | 未通过 | TUI/共享 Runtime 与历史 merge 已成形，但同字段冲突/tombstone/真并发压测、Permission、SSH/load/reconnect 与 Handoff 未完成 |

## 发布阻塞清单

1. Permission Request/Decision 必须成为可阻塞、可取消、可持久化的事件，而不是只有预选模式。
2. Run-owned baseline/patch 已能分离运行前用户改动，但仍缺 Run-owned hunk 审查与只撤销该 Run 的 Restore；还需定义 Run 期间并发用户编辑的归属/冲突策略。
3. Shared Store 已合并追加历史；仍需删除 tombstone、同字段 conflict UI/revision telemetry、真正同时双进程压力测试，才能宣称并发互操作闭环。
4. Task 的重命名/置顶/归档/重开与重启恢复已闭环；immutable Context 已进入真实 prompt 与历史。手动重排、完整用户可见状态集、Migration fixtures、Permission/Checkpoint/Artifact Snapshot、Skills/Tools 实际生效证据仍未完成。
5. Renderer/Accessibility/PTY/Packaged destructive fixture/SSH-resize-load-reconnect/Windows-Linux 自动化不足。
6. 必须用 clean release commit/CI artifact 重新生成 hashes，并完成 Apple 签名、公证和 Gatekeeper 验收。
