# RUX 交付路线与验收矩阵

| 字段 | 内容 |
| --- | --- |
| 状态 | Active delivery specification v0.2 |
| 基线日期 | 2026-08-11 |
| 产品目标 | 可信、可控、可审查、可恢复的 Coding Agent Workbench |
| 客户端 | Codex App 交互取向的 Desktop 主客户端 + Grok Build 交互取向的 TUI |
| 交付定义 | Desktop 对外发布必须满足全部 P0；本项目的完整 v1 目标还必须满足全部 P1 |

## 1. 目的与使用方法

本文档把 [`product-requirements.md`](./product-requirements.md) 转换为可执行的路线、Requirement ID、Acceptance Criteria 和发布证据。

状态只允许使用：

- **已验证**：当前代码、自动化测试与打包应用证据都覆盖验收标准。
- **部分**：存在真实实现，但验收链路缺失、数据不真实或重要状态未覆盖。
- **未实现**：仅有视觉入口、展示数据、计划或完全没有实现。
- **未验证**：实现可能存在，但当前证据不足以得出完成结论。

状态不会因为合并了代码自动升级。每次发布候选版都必须用当前 commit 的测试、打包产物和交互证据重新判定。

## 2. 优先级

| 优先级 | 含义 | 发布规则 |
| --- | --- | --- |
| P0 | 可信 Desktop 主闭环、数据/凭据安全、第一批 Agent 底座、自定义 Agent 和 macOS 可分发性 | 任一项未验收都不得对外发布 Desktop |
| P1 | 完整 v1 交付目标：Grok Build 风格 TUI、跨客户端一致性、Handoff 和 UX/Recovery 加强 | 可不阻塞 Desktop 受控内测；未完成前不能宣称总体产品目标达成 |
| P2 | 自动路由、多 Agent 并行、团队治理、Marketplace 和跨平台扩展 | 不得挤占 P0/P1 闭环与质量工作 |

## 3. 当前基线

本基线先来自 Runtime/Renderer 与 [`design-audit/full-functional-closure-2026-08-10/audit.md`](../design-audit/full-functional-closure-2026-08-10/audit.md)，再由本轮实现后的自动化、打包 Desktop、真实 Codex/TUI、SQLite 与 Git state 证据复核。命令、产物 hash 与实测路径见 [`release-evidence-2026-08-10.md`](./release-evidence-2026-08-10.md)。

### 3.1 已有真实基础

- Electron + React Desktop、Sandboxed Preload、Main 与 Utility Process Runtime 边界已建立。
- 原生 Workspace Picker、最近项目、受控激活和 Runtime 重启已连通。
- 单个真实 PTY 的 create/write/resize/dispose 已连通。
- SQLite 已持久化 Workspace 隔离的 Task、Message、Run 和有序 Runtime Events；`user_version=1` migration、未来版本拒绝和失败回滚已有 fixtures；启动时恢复历史并把孤立 `running` 归一为 `stopped/interrupted`，未决 Permission 保持可恢复。
- Claude Code 与 Codex 的真实 Run Adapter、事件归一化、process-group cancel 和 external session metadata 已接线；Codex 实机 Run/续聊已通过。
- Claude Code 和 Codex 的本机 CLI 登录态可读同步与官方 OAuth 委托已接线。
- 活动 Workspace 的真实 Git Changes/Diff、stale snapshot 防护、两步 Restore 与 review-only Accept 已接线；Run 还会保存独立 tree/index baseline/file patch，并提供只改 worktree、冲突时拒绝的 Run-owned Restore。
- Runtime 权威生成的 immutable Context 会进入真实 prompt；结构化 Verification 保存 command/cwd/time/exit/log/redaction，未知 exit 不会伪造通过。
- 自定义 Agent Profile 的 CRUD、校验、持久化和组合受信任 Claude/Codex 底座执行已接线。
- Runtime Protocol 已升级为 v2；Workspace-write Run 会发出 blocking RUX preflight，并持久化批准/拒绝/Stop。Desktop/TUI 都能恢复未决请求。该 gate 不是 provider-native 逐工具审批。
- Rust TUI 已通过严格 JSONL 连接独立 Runtime Host，支持 Task history、Agent/Model/Permission/Profile、Run/Resume、Context、Git review、Evidence inspector 和共享 Task Store。
- Web fallback 和 macOS arm64 `.app` 打包路径已存在；应用包包含 Runtime Host 与原生 TUI，生产不暴露 Demo Agent。

### 3.2 已证实的交付阻塞

- Run-owned Git 已有 tree/index baseline/patch 与运行前用户改动分离证据，文件级 Restore 会保留运行前 change layers 并拒绝 index/同路径漂移；仍缺 hunk review/merge 与打包 destructive E2E。
- Workspace-write Permission Request/Decision 已是 blocking、可追溯、可恢复的 RUX preflight；Claude/Codex provider-native 逐工具审批尚未接线，不能把 preflight 说成底座原生批准。
- Task 已补齐重命名、置顶、归档/恢复、最后 Task 防误归档、Blocked、Desktop/TUI Run history 与重启恢复；仍缺手动重排、独立 Failed/Interrupted 用户态，Checkpoint/Handoff 未闭环。
- 自定义 Agent Run 已保存不可变完整 Profile Snapshot 并在 Run Inspector 展示；Personal/Workspace scope 与 Skills/Tools 能力执行仍未验证。
- Desktop/TUI 共享 Store 已在写事务内按 Task/Message/Run/Event/Permission/Restore/review identity 合并陈旧快照并有双连接测试；Host/TUI 已协商 v2 并拒绝 mismatch；仍缺删除 tombstone、同字段 conflict UI、真并发压测和生成式跨语言 schema fixtures。
- Renderer、provider-native Permission、PTY 生命周期、SSH/resize/load/reconnect 与跨平台 Packaged E2E 自动化不足。
- macOS 应用未签名、未公证，未达到公开分发门槛。

## 4. 交付路线

路线按信任依赖排序，不以页面数量或视觉完成度排序。

### R0 — 事实协议与持久化核心（P0）

目标：让所有后续 UI 只渲染可追溯事实。

- 扩展并版本化 Runtime Protocol，覆盖 Task/Run、Permission、Context Snapshot、Artifact、Verification、Git Change 和 Checkpoint 事件。
- 建立持久化 Event Store 和 Schema Migration；定义幂等写入、顺序、中断恢复和历史快照语义。
- 移除生产路径的固定成功文案、Changed 统计和 Showcase 结果；无证据时显示“未执行”或“未知”。
- 建立 deterministic fake adapter 和 fixture repositories，使 Runtime、Git、Permission 和恢复可自动化测试。

退出条件：`RUN-01`、`PERSIST-01`、`PERSIST-02`、`TEST-01` 已验收。

### R1 — Desktop 可信核心闭环（P0）

目标：从“原型可点”变成“真实任务可安全交付”。

- 完成 Codex App 取向的 Workspace → Task → Composer → Run → Review → Accept/Restore → Restart/Resume 主流程。
- 连接真实 Git baseline、Run-owned patch、Diff、Verification 与 Checkpoint，保留用户预存变更。
- 让 Context 选择真正生成 Run Snapshot；让 Permission Request/Decision 成为可持久化事件。
- 完成 Stop、Interrupted、Failed、Retry 和受支持的 Resume 语义，删除假 Pause、假 Checkpoint 和假 Handoff。
- 核心可见控件要么真实可用，要么在生产界面移除或以明确原因禁用。

退出条件：`WORKSPACE-01`、`TASK-01`–`TASK-02`、`DESKTOP-01`–`DESKTOP-04`、`CHANGES-01`–`CHANGES-03`、`CONTEXT-01`、`PERM-01`、`RECOVERY-01` 已验收。

### R2 — Agent 底座与自定义 Agent（P0）

目标：证明 RUX 是多 Agent Workbench，而不是 Claude Code 的展示外壳。

- 完成 Claude Code Adapter 的持久化、权限映射、取消、验证证据与支持时的 session resume。
- 实现 Codex CLI Run Adapter，复用同一事件与安全语义；鉴权成功不计作 Adapter 成功。
- 设计统一 Capability Descriptor，用户在选择前可看到 Model、Permissions、Tools、Resume 和已知限制。
- 完成自定义 Agent 的 CRUD、校验、状态、真实 Run 与不可变历史快照。
- RUX mock 仅保留在开发/测试模式，或替换为真实可验收 Agent。

退出条件：`AGENT-01`–`AGENT-04`、`CUSTOM-01`–`CUSTOM-03`、`CAPABILITY-01`、`AUTH-01` 已验收。

### R3 — Desktop 产品化与 macOS 发布（P0）

目标：交付可安装、可升级、可回滚的 Desktop 发布候选版。

- 完成主流程键盘路径、焦点管理、无障碍语义、空/错误/离线状态和小窗口适配。
- 建立 Unit、Integration、Renderer、Packaged Desktop E2E、Migration、Crash Recovery 和 Security 回归组合。
- 在打包应用上重跑经典验收场景，保存当前版本截图/录屏和日志。
- 完成 Developer ID 签名、Hardened Runtime、Notarization、Stapling、Gatekeeper 检查和干净机安装。
- 生成 Release Notes、checksums、已知问题、数据迁移说明与回滚步骤。

退出条件：全部 P0 需求已验收，且通过 Gate A–D。

### R4 — Grok Build 风格 TUI 与双客户端 v1（P1）

目标：在不分裂 Runtime 的前提下，交付键盘优先的日常编程 Agent 体验。

- 将 Protocol、Client SDK、Agent Definitions 与 Event Store 访问层抽成 Desktop/TUI 共用包。
- 完成 Workspace/Task 导航、Composer、Agent/Model 选择、Activity Stream、Permission、Context、Diff/Verification、Stop 和 Outcome 的纯键盘路径。
- 在 SSH、小视口、resize、高频 Event、断网和 Runtime 重启下稳定运行。
- 在 Desktop 创建 Task 后可从 TUI 继续，反向亦然；两端显示相同的 Run/Permission/Change 事实。

退出条件：`TUI-01`–`TUI-04`、`HANDOFF-01`、`UX-02` 已验收，并通过 Gate E。

### R5 — 高级路由、并行与团队能力（P2）

- Agent/Model 推荐和经用户批准的自动路由。
- 隔离的多 Task/多 Agent 并行与合并审查。
- 团队 Agent/Skill/Permission Policies、签名分发与审计。
- Agent Templates Marketplace、评测与质量/成本比较。
- Windows/Linux 生产分发。

## 5. P0 验收矩阵

### 5.1 Desktop 主任务流

| ID | 需求 | 可验证 Acceptance Criteria | 必需证据 | 当前基线 |
| --- | --- | --- | --- | --- |
| WORKSPACE-01 | Workspace 打开、授权与切换 | 原生 Picker 选中目录后创建受权 Workspace 并记入最近列表；只能激活已授权路径；点项目标题只展开，点 Task 时激活所属 Workspace；切换后旧 Runtime、Run 与 PTY 均退出 | Main/Runtime integration + traversal/security tests + packaged E2E | 部分；空 Workspace、原生 Picker、项目展开/Task 激活与 Runtime 切换已在打包应用验收，缺完整 traversal/process 自动化矩阵 |
| DESKTOP-01 | Codex App 取向的导航与层级 | 浅色平面侧边栏、单任务 Transcript、底部 Composer、按需 Changes/Context/Run；项目标题只展开，Task 点击激活 Workspace，“当前项目”与“账户与登录”不混用 | 打包应用 E2E + 桌面截图 + 可访问性树 | 部分；打包主层级与独立项目选择器已验收，未做同版本 Codex App source/prototype 视觉对照和完整可访问性树验收 |
| DESKTOP-02 | 新建 Task 设置真实有效 | 用户选择 Workspace、Agent、Model、Context 和 Permission 后创建 Task；列表和 Run Snapshot 显示完全相同的选择；无效设置阻止启动并聚焦错误字段 | Renderer tests + 打包应用 E2E | 部分；Workspace/Agent/Model/Permission/Profile 进入真实 Run；Runtime 重新读取并注入 immutable Context，但缺完整的显式 Context 选择器、无效字段聚焦与 Renderer E2E |
| DESKTOP-03 | 执行中可观察与可控 | 每个 Run 显示当前 Agent/Model、活动、等待权限、文件变更、验证和终态；Stop 在规定超时内终止进程组并产生 Cancelled，不标记 Completed | Fake adapter integration + 真实 Claude/Codex 受控 smoke + E2E | 部分；真实事件、Stop/cancel、Codex smoke、Verification、Run-owned stats 与 blocking Permission/Stop 自动化已通过，完整 Claude 与同版 packaged Permission 场景不足 |
| DESKTOP-04 | 无可见假功能 | 核心流程中所有可交互控件都能产生符合标签的结果；未实现能力不出现，或以 disabled + 原因明确表达；无点击后静默无反馈 | 交互 inventory 自动检查 + 打包应用人工验收 | 部分；生产 Demo Agent 已移除，Changes/Context/Stop/Accept/Restore 已真实；Checkpoint/Handoff 等完整 inventory 仍未验证 |
| TASK-01 | Session/Task 生命周期 | 用户可创建、重命名、重排、完成、取消和重开 Task；Waiting、Running、Blocked、Stopped、Failed、Interrupted 和 Completed 由真实事件驱动；小任务不强制用户手动管理 Session | Store/reducer tests + renderer tests + restart E2E | 部分；创建、运行、停止、重命名、置顶、归档/恢复、最后 Task 保护和打包应用重启恢复已验收；手动重排、完整状态集与自动 Renderer E2E 未完成 |
| TASK-02 | 一个 Task 的多 Run 历史 | Retry、Continue、Resume 或切换 Agent 会产生可区分 Run；历史保留每次 Agent/Model/Context/Permission/Outcome Snapshot；新 Run 不改写旧 Run；用户可切换审查 | Store/reducer tests + multi-run E2E | 部分；Desktop Run picker 与 TUI Task/Evidence history 可切换不可变 Agent/Context/Git/Permission/Verification/Outcome，新 Run ID 不覆盖旧 Run；仍缺自动 multi-run Desktop E2E 和跨客户端同 Run 竞态验证 |
| UX-01 | 核心路径键盘与辅助技术可用 | 新建 Task、选择 Agent、Permission、Stop、Diff、Accept/Restore 全程可用键盘完成；Dialog 有 focus trap/return；Tabs 具备 `aria-selected`/`aria-controls`/tabpanel；状态不只靠颜色 | axe 等自动检查 + 键盘 E2E + VoiceOver smoke 记录 | 未验证；主控件有语义标签，但未完成 axe、全键盘和 VoiceOver release check |

### 5.2 Run 事实、持久化与恢复

| ID | 需求 | 可验证 Acceptance Criteria | 必需证据 | 当前基线 |
| --- | --- | --- | --- | --- |
| RUN-01 | 结果完全由真实事件和 Artifacts 派生 | 仅当存在对应 command、exit code 和 log 时显示某项验证通过；仅当存在 Run-owned Git patch 时显示 Changed 统计；未执行、失败和未知明确区分 | Protocol/renderer tests + 事件 fixture golden tests + E2E | 部分；固定 Showcase 结果已移除，Verification 与 Run-owned Changed 都只由结构化事件显示，未知 exit 不会伪造通过；仍缺 Renderer golden tests、Artifact/Permission 事实模型和完整 provider E2E |
| PERSIST-01 | Task/Run Event Store | 持久化 Task、Message、Run、Activity、Artifact、Verification、Permission、Checkpoint、Agent Snapshot 和 external session ID；事件有顺序且重放幂等 | Store unit/integration + schema inspection + fixture export | 部分；Task/Message/Run/ordered Events/Activity/Plan/usage/metadata/session、Agent/Context/Git/Verification、Permission 与 Restore records 已有 SQLite/Host/TUI tests；Artifact/Checkpoint 缺失 |
| PERSIST-02 | 重启不丢失用户历史 | 创建 Task 并完成/中断 Run 后退出或强制结束应用；重开后 Task、Messages、Run Events、Diff 审查位置与 Permission Decisions 不丢失；Terminal 不自动重开 | Packaged desktop restart/crash E2E + 数据库完整性检查 | 部分；Store reopen、遗留 running 归一、未决 Permission recovery 和既有 packaged restart 已实测，Context/Git/Verification 证据保留；同版 packaged Permission Decision、Run restore 与 crash automation仍待验收 |
| RECOVERY-01 | 中断、Retry 和 Resume 语义真实 | 崩溃时无法证明已完成的 Run 标记 Interrupted；Retry 创建新 Run；只有 Agent 能力与 session ID 同时存在时显示 Resume，并恢复同一外部会话 | Adapter contract tests + crash/restart E2E + session-id evidence | 部分；orphan running→interrupted、Codex external session 续聊与新 Run 保留已验证，完整 Retry/Claude/capability gating UI 不足 |
| MIGRATE-01 | 数据库升级安全 | 从前两个发布 schema 的 fixture 升级到当前版本，无 Task/Run/Permission 丢失；失败时不破坏原数据并提供回滚说明 | Migration fixtures + checksum/count assertions + upgrade smoke | 部分；无版本 v0→v1、未来版本拒绝、严格结构校验和失败事务回滚已有 3 个 fixtures；项目尚无两个已发布旧 schema，且缺 packaged upgrade/rollback rehearsal |

### 5.3 Changes、Context 与 Permission

| ID | 需求 | 可验证 Acceptance Criteria | 必需证据 | 当前基线 |
| --- | --- | --- | --- | --- |
| CHANGES-01 | 真实 Run-owned Diff | Run 开始前记录 Git/worktree baseline；完成后文件列表、hunks、行统计和 binary/untracked 状态与当前 Workspace 一致；用户预存变更明确分离 | Git fixture integration + UI diff snapshot + CLI cross-check | 部分；17 个 Git fixtures 覆盖 Workspace 分层 Diff、tree/index baseline/patch、预存 staged/unstaged/untracked、ignored、sub-workspace、真实 index bytes 不变和并发漂移拒绝；UI 分开显示 Run/Workspace totals，仍缺 Run-owned hunk/binary内容审查 |
| CHANGES-02 | Accept/Reject/Restore 真实且可逆 | Accept 只记录用户已审查该 patch，不隐式 commit/push；Restore 只撤销对应 Run 的变更并保留用户预存变更；若提供 Reject，它记录拒绝决策并执行同样的安全 Restore；操作后 Diff 和工作区立即同步 | Destructive fixture matrix + E2E + before/after Git hashes | 部分；review-only Accept、Workspace 与 Run 两步 Restore、stale tree/index/snapshot、预存 change layers、traversal/symlink fixtures 已验证；Desktop 已接 Run preview/confirm/history，仍缺 hunk Reject语义和同版 packaged destructive E2E |
| CHANGES-03 | Verification Evidence 可审查 | 每项 Test/Lint/Typecheck/Build 显示命令、cwd、时间、exit code 与可展开日志；敏感值被脱敏；未运行不显示通过 | Verification fixture tests + redaction tests + E2E | 已验证；Codex parser/adapter、redaction、Host wire、SQLite/TUI persistence 与最新 packaged Run Inspector 均覆盖；无法取得确切 exit 的 Claude Bash 明确保持 unknown |
| CONTEXT-01 | UI 与实际 Run 使用同一 Context Snapshot | 每个 Run 保存 Instructions、Selected Files、Conversation、Skills/Tools、Git State 与 Pinned Material 的 snapshot 及来源；添加/移除会改变下次 Run 输入；历史 Run 不被后续修改 | Runtime request assertions + store inspection + E2E | 部分；Runtime 权威生成 AGENTS/selected files hash+content snapshot、拒绝越界、注入同一真实 prompt，并在 Desktop/TUI/SQLite 历史恢复；Conversation、Skills/Tools 实际集合、Git State、Pinned Material 与用户增删 UX 未完整 |
| PERM-01 | Permission Request/Decision 可执行与可追溯 | 超出当前策略的操作发出包含 action、scope、impact 的 blocking event；批准/拒绝仅影响该请求或明确选择的范围；决策写入 Run History；Stop 在等待时仍有效 | Fake agent permission integration + policy tests + packaged E2E | 部分；v2 RUX preflight 会在启动 Workspace-write Run 前阻塞，Desktop/TUI 显示 action/scope/impact，批准/拒绝/Stop、历史、SQLite recovery 和 fake Host/gate tests 已闭环；它不是 Claude/Codex 逐工具审批，且同版 packaged E2E 待完成 |
| CHECKPOINT-01 | Checkpoint 与恢复对应真实项目状态 | 每个 Checkpoint 可回溯到 Workspace、Run 和确切 Git/worktree state；恢复前展示将变化内容；恢复后状态与证据一致 | Git fixture restore tests + E2E + state hash evidence | 未实现 |

### 5.4 Agent 底座、鉴权与自定义 Agent

| ID | 需求 | 可验证 Acceptance Criteria | 必需证据 | 当前基线 |
| --- | --- | --- | --- | --- |
| AGENT-01 | Claude Code Adapter 完整闭环 | 安装/未安装、已登录/未登录、成功、工具失败、API retry、cancel、crash 和受支持 resume 都归一化为可持久化事件；进程只在授权 Workspace 运行 | Fake CLI contract suite + 受控 real CLI smoke + packaged E2E | 部分；可用性、stream-json、cancel、持久化与外部 metadata 已接线，完整 fake lifecycle/real packaged smoke 不足 |
| AGENT-02 | Codex Adapter 完整闭环 | 与 `AGENT-01` 相同的生命周期、事件、安全和证据门槛；在选择器中可真实启动 Codex Run | Fake CLI contract suite + 受控 real CLI smoke + packaged E2E | 部分；fake CLI start/cancel/parser、真实 Codex Run 与同 session 续聊已通过，错误/retry/auth/crash 全矩阵与 Desktop packaged click E2E 不足 |
| AGENT-03 | Agent/Model/Capability 选择可理解 | 选择器区分 Agent 与 Model，展示安装、鉴权、Permission、Tools、Resume 和已知限制；Unavailable 有可操作修复方式；实际 Run Snapshot 与选择一致 | Capability schema tests + renderer tests + E2E | 部分；Claude/Codex/custom profile、model/permission 与可用性进入真实 Run/TUI status，能力和不可用修复表达不完整 |
| AGENT-04 | 生产环境无假 RUX Agent | 默认生产包不把 mock 标记为可完成真实开发的 Agent；若保留则只在开发模式可见且明确标记 Demo | Production bundle inspection + E2E | 已验证；production utility/standalone Host 禁用 mock，打包 Agent 菜单只出现 Claude Code 与 Codex；Demo 仅开发显式启用 |
| AUTH-01 | 官方 CLI 鉴权边界 | RUX 仅调用 `claude auth status`、`claude auth login`、`codex login status` 与 `codex login`；Renderer 仅收到非敏感状态；不读凭据文件、不复制/记录 Token；自动化测试使用 fake CLI | Auth boundary tests + IPC payload inspection + packaged read-only status check | 已验证当前状态同步路径；真实重授权按规则未在常规验收中执行 |
| CUSTOM-01 | 自定义 Agent CRUD 与持久化 | 可创建、编辑、复制、删除 Personal/Workspace Definition；名称、Adapter、Model、Instructions、Context、Skills/Tools、Permission 均可恢复；冲突有明确解决方式 | Store/schema tests + renderer tests + restart E2E | 部分；Desktop Editor 已支持 create/update/copy/delete，Store 有 5 tests；缺 Personal/Workspace scope 和 renderer restart E2E |
| CUSTOM-02 | 自定义 Agent 校验与安全 | Schema 错误定位到字段；启动前校验 executable/adapter、auth、model 与 capability；无效 Agent 不能运行；Definition 不允许明文凭据；可执行文件必须由用户明确选择或来自受信 Adapter，cwd、Context 与文件参数不能越过已授权 Workspace | Validator/security tests + malicious fixture matrix + E2E | 部分；严格 schema 拒绝 duplicate/secret/executable 字段，只能组合受信 Claude/Codex backend；auth/model/capability 和 malicious workspace matrix 不足 |
| CUSTOM-03 | 自定义 Agent 真实执行与历史快照 | Ready Agent 可从 Composer 选择并执行真实 Run；Run 保存完整 Definition Snapshot；后续编辑/删除不改写历史并且旧 Run 仍可审查 | Adapter integration + snapshot tests + restart E2E | 部分；Standalone Host 证明 profile 指令进入底座并发出完整 snapshot，Desktop/TUI 都持久化，Store reopen 保留，Run Inspector 展示；缺真实 Custom Agent packaged click/restart/delete E2E |
| CAPABILITY-01 | Skills/Tools 对实际 Run 生效 | Personal/Workspace Skills 可查看与启停，Tool 可用性与权限可见；Run Snapshot 保存实际启用集合；停用后下一个 Run 不可调用；Tool Activity/Result 进入可审计时间线 | Capability/store tests + fake adapter assertions + E2E | 未实现；Profile 可保存 Skill/Tool IDs，真实 Context 会显示 capability 摘要，但尚无启停执行策略、Run Snapshot 或调用审计证据 |

### 5.5 平台安全、测试与分发

| ID | 需求 | 可验证 Acceptance Criteria | 必需证据 | 当前基线 |
| --- | --- | --- | --- | --- |
| SEC-01 | Desktop 进程边界与 Workspace 授权 | Renderer 无 Node integration，Preload 只暴露 typed API，Main 校验 envelope，Runtime 校验 params；RUX 传入 PTY/CLI/Git 的 cwd 和文件路径仅位于已授权 Workspace，越界尝试被拒绝或进入明确 Permission 流程；切换 Workspace 销毁旧 PTY 和 Run | Static/security tests + traversal fixtures + process lifecycle integration | 部分；边界已有，未完成全功能安全回归 |
| TERM-01 | 终端生命周期完整 | 创建、输入、输出、resize、shell exit、用户关闭与 Workspace 切换都不泄漏进程；重启应用不自动恢复终端 | PTY integration + packaged E2E + process leak check | 部分；真实单 PTY 已手工验收，无自动 E2E |
| TEST-01 | 需求到测试的可追溯性 | 每个 P0 ID 至少对应一个会在 CI 运行的测试或明确的人工 release check；证据记录 commit、平台、产物 hash 和结果 | CI report + requirement-test manifest + release evidence index | 部分；本矩阵与 release evidence 已映射核心证据和产物 hash，但每个 P0 ID 的 CI manifest/截图索引仍不完整 |
| TEST-02 | 核心自动化组合 | CI 包含 Typecheck、Protocol/Store unit、fake CLI adapters、Git/Permission integration、Renderer interaction、Migration、Packaged Desktop E2E 与 Web/Sites compatibility；任一失败阻塞发布 | CI required checks + test reports/artifacts | 部分；统一 `npm test` 当前 56 tests，覆盖 Store/Auth/Agents/Adapters/Runtime/Git/Sites/TUI；缺 Permission、Renderer、Migration、PTY 与 packaged E2E CI |
| TEST-03 | 经典桌面场景验收 | 在当前打包应用上通过新建并 Accept、Permission Reject、Stop、Restore、Restart Resume、Codex Run、Claude Run、Custom Agent Run 场景；证据是稳定状态，不是 loading 截图 | Versioned E2E logs + screenshots/video + fixture Git states | 部分；打包首启、项目展开、Task lifecycle/restart、生产 Agent 菜单、TUI→Desktop history、Changes/Accept 与 Context/Git/Verification restart UI 已实测；Permission Reject、Run-owned fixture Restore、完整 Claude/Custom click flow 未覆盖 |
| DIST-01 | 可复现的生产打包 | Clean checkout 通过 `npm test`、`npm run build`、`npm run build:desktop`、`npm run package`；产物版本与 commit 可追溯；生产包不包含开发 mock 入口和敏感日志 | CI logs + artifact manifest + checksum | 部分；统一 test/build/package 通过，包内 Runtime Host/TUI hash 已记录且 production 无 mock；工作树未形成 clean release commit/CI artifact |
| DIST-02 | Developer ID 签名与 Hardened Runtime | 所有嵌套 frameworks、helpers、native modules 都使用预期 Team ID 签名；`codesign --verify --deep --strict --verbose=2` 成功；entitlements 最小化且经审查 | codesign output + entitlement dump + signing identity record | 未实现 |
| DIST-03 | Apple 公证、Stapling 和 Gatekeeper | Apple Notarization 成功，发布产物已 staple；`xcrun stapler validate` 与 `spctl --assess --type execute --verbose=4` 成功；无开发工具的干净 macOS 用户可正常安装首启 | Notary log + stapler/spctl output + clean-machine video | 未实现 |
| RELEASE-01 | 发布产物可追溯与可回滚 | Release 包含 semver/build number、commit、checksum、Release Notes、已知问题、schema 迁移和回滚说明；上一版数据升级后可正常启动；回滚不声称能读取不支持的新 schema | Release manifest + upgrade/rollback rehearsal | 未实现 |

## 6. P1 验收矩阵

| ID | 需求 | 可验证 Acceptance Criteria | 必需证据 | 当前基线 |
| --- | --- | --- | --- | --- |
| WORKSPACE-02 | 多 Workspace/Task 搜索可理解 | 搜索匹配收起项目中的 Task 时直接显示分组结果或自动展开；有结果数、无结果空态与清除路径；键盘可选中并打开对应 Workspace/Task | Renderer tests + packaged E2E | 部分；当前匹配会被收起项目隐藏 |
| TUI-01 | 共享 Runtime 与 SDK | TUI 不直接复制 Claude/Codex/Git/Permission 逻辑；Desktop 和 TUI 依赖同一版本化 Protocol/Client SDK/Agent Definition；协议版本不兼容时明确拒绝连接 | Package dependency inspection + contract suite 同时运行两客户端 | 部分；TUI 通过同一 TypeScript Host 复用 Adapter/Git/Context/Profile/Store，Host advertises v1，TUI mismatch 明确报错并阻止 Run；Rust boundary 仍手工维护，缺 generated schema fixture suite |
| TUI-02 | Grok Build 取向的键盘主流程 | 不使用鼠标可完成 Workspace/Task 选择、Composer、Agent/Model、Run、Permission、Context、Diff/Verification、Stop 和 Outcome；持续显示 Active Task/Run/Agent/Permission 状态；快捷键可发现 | Pseudo-terminal E2E + terminal recordings + shortcut map | 部分；Composer、Agent/Model/Permission/Profile、真实 Run/resume、Stop、Context、Diff、Accept、两步 Restore、Run-owned/Verification summary 与 status 可纯键盘完成；blocking Permission、完整 Verification inspector/task picker 未完整 |
| TUI-03 | 远程、resize 与长 Run 稳定 | 在 SSH 等价环境、80×24 和常用大小间 resize、高频事件、长输出和断线重连下不丢失持久化事件，不出现无法退出的界面 | PTY/load/reconnect suites + resource profile | 部分；80×24 实机、real child transport、退出终端恢复和持久化已通过；SSH、resize/load/long-output/reconnect 组合未验证 |
| TUI-04 | Desktop/TUI 状态互操作 | Desktop 创建的 Task 可在 TUI 打开并继续；TUI 产生的 Run、Permission Decision、Diff Review 在 Desktop 可见；两端不对同一 Run 产生冲突终态 | Cross-client E2E + event-store comparison | 部分；TUI Task/Message/Run/session 已在打包 Desktop 打开，TUI restart 也恢复；双 Store 陈旧 Snapshot 合并 test 保留双方 Message/Event/review；Permission Decision、完整 Desktop→TUI 与真并发/同字段冲突 E2E 未完成 |
| HANDOFF-01 | Agent Handoff 保留可审计上下文 | 从一个 Agent 交给另一个 Agent 时创建新 Run，明确展示携带的 Goal、Context、Artifacts、Open Questions 和 Permission Policy；旧 Run 不改写；新 Agent 不支持的能力在开始前阻塞或降级 | Handoff contract tests + Claude↔Codex E2E | 未实现 |
| CUSTOM-04 | Agent Definition 导入/导出与变更历史 | 导出不包含凭据；导入前预览能力/权限差异并校验；变更可比较与回滚；旧 Run Snapshot 不改变 | Round-trip/golden/security tests + E2E | 未实现 |
| UX-02 | 性能与长任务 UX 门槛 | 在公开的参考硬件和 fixture 规模下定义并达到启动、Task 切换、事件到界面延迟、大 Diff 滚动和内存稳态目标；超出时显示可恢复错误而非无限 loading | Reproducible benchmark profile + traces + threshold config | 未实现 |

## 7. P2 验收主题

P2 在 P0/P1 完成后分别拆成独立需求和验收矩阵：

- `ROUTING-*`：基于用户可见规则的 Agent/Model 推荐与经批准自动路由。
- `MULTI-*`：多 Task/多 Agent 并行隔离、资源限制、冲突检测和合并审查。
- `TEAM-*`：团队 Agent/Skill/Tool/Permission Policies、审批和审计导出。
- `MARKET-*`：签名 Agent Templates、依赖/权限预览、版本化和撤回。
- `PLATFORM-*`：Windows/Linux 终端、打包、签名、更新和干净机验收。

## 8. 经典端到端验收场景

### E2E-01 — 首次完成真实 Claude Code 任务

1. 从干净 RUX 用户数据打开 fixture Git Workspace。
2. 同步 CLI 状态，选择 Claude Code 和受支持 Model。
3. 使用专用测试账户和已批准额度，选择 Context 和低风险 Permission Policy，创建一个会修改单文件并运行可控验证的 Task。
4. 观察真实 Activity，处理一个 Permission Request，等待真实终态。
5. 对照 Git 查看 Diff 和 Verification Evidence，选择 Accept。
6. 退出并重开 RUX，相同 Task、Run、Agent Snapshot、Diff 与审查结果仍存在，Terminal 未自动重开。

### E2E-02 — Codex 与 Stop

1. 在同一 Workspace 创建新 Task，选择 Codex。
2. 启动一个长时间 fake/controlled Run，确认 Runtime 显示 Codex Adapter 和实际 Model。
3. 点击 Stop，确认子进程组退出，终态为 Cancelled，无固定成功或虚假 Changed 结果。
4. 重开应用，Cancelled 状态保持；Retry 创建新 Run ID，不改写原 Run。

### E2E-03 — Restore 保留用户变更

1. Fixture Workspace 预先包含用户的 modified 和 untracked 文件。
2. Agent Run 修改另一文件，并与用户在同一文件的无重叠 hunk 产生可归属变更。
3. Changes 明确区分 baseline 与 Run-owned patch。
4. Restore 后 Agent 变更消失，用户预存变更逐字节保留，审计时间线记录操作。

### E2E-04 — 自定义 Agent 创建、校验与历史

1. 创建 Custom Agent，故意配置无效 executable 和不支持 Model；校验精确指出两个字段且阻止 Run。
2. 修正配置，通过 Auth/Capability 检查，Agent 成为 Ready 并出现在 Composer 选择器。
3. 用该 Agent 完成真实 Task，查看 Run Snapshot。
4. 修改名称和 Instructions 后，历史 Run 仍显示旧 Snapshot；删除 Definition 后历史仍可审查，但不能无提示重跑。

### E2E-05 — Desktop/TUI 交叉继续

1. Desktop 创建 Task 并中断一个 Run。
2. 在 TUI 打开同一 Workspace，看到一致 Task、Run、Context Snapshot 和 Interrupted 状态。
3. TUI 启动新 Run，处理 Permission 并完成 Review。
4. Desktop 重开后展示同一 Run ID、Permission Decision、Diff、Verification 和 Outcome。

## 9. 测试组合与证据合同

| 层级 | 必须覆盖 | 不足以作为证据的替代品 |
| --- | --- | --- |
| Type/Schema | Protocol compatibility、Zod params/events、Agent Definition、Store schema | 仅 TypeScript 编译通过 |
| Unit | Event reducer、result derivation、redaction、diff attribution、permission policy、migration | 仅测试帮助函数 |
| Adapter contract | Claude/Codex/fake custom CLI 的成功、错误、cancel、retry、permission、malformed output | 仅 `--version` 或登录态 |
| Integration | Runtime IPC、Event Store、Git fixtures、PTY、Workspace 授权、Context/Permission | 仅 Renderer mock |
| Renderer | 主流程互动、空/错误状态、键盘/焦点、无障碍语义 | 仅视觉 snapshot |
| Packaged Desktop E2E | 经典场景 E2E-01–04、重启/崩溃、干净 profile | Browser fallback E2E |
| TUI E2E | 纯键盘、PTY resize、SSH 等价环境、跨客户端 E2E-05 | 直接调 Runtime 不经 TUI |
| Release | 签名、公证、Gatekeeper、升级/回滚、artifact checksum | 本机双击未签名 `.app` |

每次 Release Candidate 的证据索引至少记录：

- commit SHA、版本/构建号、平台与测试时间；
- 打包产物绝对标识或 CI artifact URL 与 SHA-256；
- 每个 Requirement ID 对应的 test name/report 或 manual check；
- 稳定状态截图/录屏、Runtime logs、fixture 前后 Git state；
- 已知失败、跳过原因与批准人；P0 不允许用“已知问题”跳过。

## 10. 发布 Gates

### Gate A — 事实与数据完整性

- `RUN-01`、`PERSIST-01`、`PERSIST-02`、`MIGRATE-01` 已验收。
- 生产路径无 Showcase Changes/Context/Run Result。
- 所有完成、验证和变更声明都可展开到真实证据。

### Gate B — Desktop 内部 Alpha

- Gate A 通过。
- Claude Code 主流程、Permission Reject、Stop、Restore 和 Restart 通过打包应用 E2E。
- 无可见核心 no-op；已知未实现能力已移除或明确禁用。

### Gate C — Desktop 私测/Beta

- Claude Code、Codex 和 Custom Agent 各至少一个真实受控 E2E 通过。
- 核心键盘路径、VoiceOver smoke、崩溃恢复、长 Run 和大 Diff 验收通过。
- 完成至少一轮非开发者用户测试；所有 P0 信任/数据问题已修复并回归。

### Gate D — macOS 公开发布

- 全部 P0 矩阵为已验证，CI required checks 全绿。
- Developer ID、Hardened Runtime、Notarization、Stapling、Gatekeeper 和干净机安装通过。
- Release manifest、checksums、Release Notes、schema 升级与回滚演练证据完整。

### Gate E — 完整 RUX v1

- Gate D 通过。
- 全部 P1 矩阵为已验证。
- Desktop/TUI 交叉场景 E2E-05 通过，并证明两客户端使用同一 Runtime 和 Event Store。

## 11. 不允许的验收捷径

- 不得用编译成功证明产品流程闭环。
- 不得用 Browser fallback 截图代替打包 Desktop 验收。
- 不得用 CLI 已安装或已登录证明 Agent Adapter 可执行。
- 不得用 mock/showcase 数据证明 Changes、Context、Permission、Verification 或 Checkpoint。
- 不得用按钮存在证明 Accept、Restore、Stop、Handoff 或 OAuth 完成。
- 不得从截图声称完整无障碍合规。
- 不得用未签名本地 `.app` 证明产品可公开分发。
- 任何未有当前 commit 证据的 P0/P1 项都按“未验证”处理，不从计划、代码意图或旧版截图推断完成。
