# RUX Goals

更新时间：2026-08-17

状态约定：

- `[x]` 已实现，并已有自动化测试、桌面验收或当前产品事实支持。
- `[ ] TODO` 尚未实现、只完成部分平台，或仍缺少正式发布条件。
- 本清单从 `product-requirements.md`、根目录 `AGENTS.md` 的 Current Product Truth 和现有验收证据整理；不把规划项写成已完成。

## Goal 1：Codex 风格桌面工作台与 Workspace 闭环（P0）

- [x] 本地优先，无需 RUX 云账号即可打开项目和工作。
- [x] 保持 Codex Desktop 风格的侧栏、单 Task Transcript、底部 Composer 和按需 Inspector。
- [x] 原生打开项目、最近项目、Workspace 切换和明确的授权边界。
- [x] Workspace 切换时停止旧 Run，并清理旧 Runtime、PTY 和临时会话状态。
- [x] Task 历史、草稿、侧栏和审查偏好跨启动保留；Terminal Session 不自动恢复。
- [x] Composer 可通过原生选择器添加 Workspace 内文件，显示并移除 Context。
- [x] Main/Runtime 对文件进行 realpath、组件边界、符号链接、大小和 Secret 校验。
- [x] 使用用户提供的 ChatGPT Codex 26.810.52044 权限状态参考图完成同状态真实打包验证与 1433×812 同尺寸并排对照；修复 Inspector 挤压 736px 主 rail 的最后一项结构偏差，证据保存在 `design-audit/final-local-goals/`。

## Goal 2：Agent 与 Provider 连接管理（P0）

- [x] 支持 Codex、Claude Code 和独立的 Rux Native Agent/Engine。
- [x] Agent 选择器可切换 Agent；有内容的 Task 切换 Agent 时创建新 Task，不改写原 Task。
- [x] 账户面板区分 Agent/Provider 管理与 Workspace 选择。
- [x] 显式检测 Codex/Claude Code 的安装、版本和非敏感连接状态。
- [x] 检测结果仅缓存规范化非敏感字段，不在启动或打开面板时自动检查 CLI。
- [x] 发起 Run 前重新校验 CLI Agent 的真实连接状态。
- [x] 未安装状态、官方安装入口、重新检测和可恢复错误已实现。
- [x] 登录委托官方 `codex login` 与 `claude auth login`，不读取或复制 CLI 凭据。
- [x] 登录取消、超时和进程树终止有测试覆盖。
- [x] 提供显式、二次确认的官方 CLI logout 委托流程；仅调用 `codex logout` 或 `claude auth logout`，不自行删除凭据。

## Goal 3：Agent Definition、Revision、模型与权限（P0）

- [x] Agent Definition 绑定 Engine、非敏感 Connection、模型、指令、权限、Skills 和 Tools。
- [x] 每次保存追加不可变 Agent Revision；Task 固定创建时 Revision。
- [x] Agent 更新不改写既有 Task；用户可显式基于新版 Revision 创建空白新 Task。
- [x] 删除 Definition 后保留历史 Revision，已有 Task 仍可审查。
- [x] Composer 先选 Agent，再选该 Engine/Connection 的兼容模型。
- [x] 支持 Engine 默认、结构化目录、同 Connection 验证历史和高级手动模型 ID。
- [x] Codex 模型目录来自官方 App Server `model/list`。
- [x] 手动模型只在成功 Run 后标记为已验证；网络、认证、配额错误不会误标为不可用。
- [x] 支持只读、请求批准、自动批准三种权限模式。
- [x] Codex/Claude Code 使用 provider-native 具体命令、文件和权限审批，不使用虚假的整 Run 粗粒度授权。
- [x] 每个 Run 可回看实际 Agent 快照、Engine、Connection、Revision、模型和权限决策。

## Goal 4：基础对话、Run 生命周期与 Native Session（P0）

- [x] Codex、Claude Code 和 Rux Native 均使用真实 Adapter，不以 Showcase Mock 代替桌面运行。
- [x] 用户消息、Assistant 消息、Run 事件、权限决定和 Session ID 持久化到 Workspace SQLite。
- [x] 支持 Assistant 流式输出，并只持久化完成后的最终消息。
- [x] 支持运行中 Stop，停止 Provider 进程/Turn 并保留已经收到的证据。
- [x] 支持失败状态、同 Session 重试和显式创建空白新 Session Task。
- [x] 同一 Task 的后续输入按 Engine、Connection、Revision、Workspace 恢复同一 Native Session。
- [x] Native Session 恢复失败不会静默新建 Session，而是保留失败证据和恢复分支。
- [x] 冷启动 Codex `thread/start/resume` 使用有界 120 秒窗口，其余普通 RPC 保持 30 秒。
- [x] 实际打包应用已验证 Codex 新会话、同 Session 续聊、实际模型/Token 展示和 Stop。

## Goal 5：Changes、Context、Git 与运行证据（P0）

- [x] Changes 使用 Runtime Git 快照和真实 Diff，不使用普通桌面假数据。
- [x] Run 启动前记录 Git baseline，完成后保存不可变 Run-owned patch。
- [x] 区分 Workspace 全局未提交变化和当前 Run 产生的变化。
- [x] 支持 Changes 审查与不修改 Git 内容的“接受审查”记录。
- [x] 支持带快照防护的单文件、全部变化和 Run-owned 变化撤销预览。
- [x] 撤销保护预先存在的用户修改、后续漂移、Git index 和授权 Workspace 外文件。
- [x] Native 文件/命令工具修改 Workspace 后触发 Changes 和 Context 权威重读。
- [x] Run/Assistant turn 显示实际模型与 Token；Provider 未报告时明确显示“未报告”。

## Goal 6：外部 Codex/Claude 会话接入（P1）

- [x] 会话发现仅由用户显式触发，首次只读取非敏感元数据。
- [x] Codex 使用官方 App Server Thread List/Read；Claude 使用官方 Agent SDK Session 接口。
- [x] 当前 Workspace 范围、最具体 realpath 归属、父子 Workspace 去重和待归属状态已实现。
- [x] Workspace 外会话必须先授权对应项目，Renderer 不能绕过归属边界。
- [x] 用户选择后才读取完整内容，并可选择“仅导入查看”或“导入并继续”。
- [x] 全局身份按 Engine、Connection、Native Session ID 去重，重复导入不创建重复 Task。
- [x] 导入并继续固定原 Engine、Connection、Agent Revision、Workspace 和 Native Session。
- [x] 更具体 Workspace 出现时提供显式审计迁移，不复制 Task、不修改 Provider 会话。
- [x] 不宣称实时双向同步；RUX 保存本地规范化 Projection。

## Goal 7：外部会话刷新、版本与本地数据生命周期（P1）

- [x] 刷新仅由用户触发，不后台轮询。
- [x] 仅新增内容时稳定去重并增量追加。
- [x] 修改、删除、重排和不确定匹配进入差异候选，不覆盖当前 Projection。
- [x] 用户确认重建前保存不可变 Projection Revision。
- [x] 支持查看并恢复旧本地 Revision，且不反向修改 Native Session。
- [x] 重建/恢复不删除 RUX 自有 Run、审批、Task 和 Handoff 数据。
- [x] 支持 Task/Workspace 占用查看和影响预览。
- [x] 支持解除关联、删除导入内容、删除 Task/Workspace Tasks，并区分不可恢复边界。
- [x] 支持当前/全部 Revision 的 Markdown 与 JSON 导出，排除结构化凭据字段。
- [x] 导入内容与旧 Revision 不自动过期，不因空间压力静默清理。

## Goal 8：跨 Agent Context Handoff（P1）

- [x] 从持久化消息、最新 Run、Run-owned 文件证据、未完成计划和来源 Revision 生成确定性事实包。
- [x] 用户可选择目标 Agent、消息和文件，并在确认前预览和编辑。
- [x] 可显式调用固定的来源 Agent 生成可选摘要；摘要禁用工具、隔离执行并带来源标记。
- [x] 没有 Agent 摘要时仍可只用确定性事实完成交接。
- [x] Main 解析目标 Connection 与最新 Revision，Renderer 不能伪造目标绑定。
- [x] 确认事务创建新 Task、固定目标 Revision、保存不可变 Handoff 快照并建立双向来源关系。
- [x] 确认前不调用目标 Agent、不创建目标 Native Session；来源后续变化不改写快照。
- [x] 大任务 Handoff 支持最多 500 条持久化消息的搜索/角色筛选/批量选择，默认最近 20 条；文件显示状态与增删统计，预览显示来源/目标 Revision、Engine/Connection、模型/权限、事实指纹、最新 Run 和未完成项诊断。

## Goal 9：Auto 模型路由与 Token 证据（P2-E0）

- [x] Agent Revision 可配置简单模型、复杂模型、策略、回退和同 Connection 白名单。
- [x] 使用可解释的确定性简单/复杂分类器，不额外调用模型分类。
- [x] 每个 Run 开始前固定一个不可变 Model Decision，执行中途不换模。
- [x] Auto 不跨 Agent、Engine、Connection、Revision 或白名单边界。
- [x] 未验证手动模型不能进入 Auto 白名单。
- [x] Engine 未明确支持同 Session 按 Run 换模时，阻止试探性切换并提供固定模型/新 Task 路径。
- [x] 明确不兼容时只按策略在白名单内回退；认证、网络、配额错误不触发永久失效。
- [x] Transcript 和 Run 面板展示实际模型、分类原因、回退证据及输入/缓存输入/输出/推理/总 Token。
- [ ] TODO（条件未触发）：当前仍使用无额外 Token 的确定性 Router；只有未来改用模型型 Router 时，才必须单独记录 Router 模型、Token、费用和来源，不能混入业务 Run 用量。

## Goal 10：Rux Native Provider 编码闭环（P2-E1）

- [x] Responses-compatible Connection 可在没有 Codex/Claude CLI 时运行 Rux Native Agent。
- [x] API Key 由 Main 使用 OS `safeStorage` 加密；Renderer、普通 IPC、Task Store、日志和导出拿不到明文。
- [x] OS 加密不可用时拒绝保存，不降级为明文。
- [x] Provider 只在用户显式测试或 Run 时访问；打开应用/账户面板不触发网络。
- [x] 支持 Connection 新建、元数据编辑、显式 Key 替换、凭据删除和指纹化影响预览。
- [x] 显式测试保存 Provider 返回的模型目录与明示能力，不推断未知能力。
- [x] 支持流式响应、受限文件工具、实际模型/response id/Token、工具活动和 Run-owned Git 证据。
- [x] macOS 命令工具使用无 Shell argv、受限环境、独立临时目录、超时、输出上限、进程树取消和 `sandbox-exec`。
- [x] 无等价沙箱的平台不暴露命令工具，不降级为未隔离 Shell。
- [x] 支持 OS 加密的 Custom Headers；Renderer 只看到 Header 名称，值仅在 Main/Runtime 内存边界使用。
- [x] 支持 Anthropic Messages 原生协议、官方鉴权/版本头、模型目录、Streaming、Tool Use、Token Usage，以及无原生 Session API 的有界同 Task 对话历史。
- [x] Rux Native 已覆盖 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages 三种原生协议，共享显式模型目录/Provider 报告能力协商、流式输出、工具循环、Token、历史边界和网络安全合同；新增协议必须有官方合同和同等级测试，不做猜测式兼容。
- [x] 已完成 Rux Native 原生 OAuth 合规设计合同，覆盖 Provider 注册门槛、Authorization Code + PKCE、端点约束、Main/Runtime Token 保管、撤销、迁移和安全验收；当前不伪造任何 Provider 登录能力。
- [ ] TODO（外部阻塞）：取得 Provider 官方桌面 OAuth 合同与 RUX Client 注册后，实现对应 Provider Adapter 并完成真实授权、刷新、撤销和打包验收；不得复用或复制 CLI/个人订阅凭据。
- [ ] TODO（目标平台阻塞）：在 Windows/Linux 目标机实现并验证等价命令沙箱；当前非 macOS 平台继续安全省略命令工具，不降级为未隔离 Shell。
- [x] 提供 Main-owned 平台凭据库诊断和确认门控的安全重新封装：只返回后端、计数和失败标签，预检全部密文后原子写入，并保留仅含密文的本地备份；Renderer 不接触 Secret。

## Goal 11：共享 Runtime 协议与 TUI（跨阶段）

- [x] Desktop Main、Runtime、Renderer 与 stdio Host 使用共享 Zod/JSONL 协议边界。
- [x] TUI 可通过同一语言无关 Runtime 边界启动任务、查看状态、权限和运行证据。
- [x] TUI 已有 Rust 单元测试、PTY 流程测试、Runtime 流程测试和 Clippy 验证。
- [x] TUI 已补齐可安全共享的 Agent Revision 管理、官方 CLI Provider 状态/登录/登出、外部会话发现/导入/刷新/重建/版本恢复、确定性 Handoff 与可选隔离摘要、本地数据影响预览/清理/导出、Workspace/Run-owned Changes、显式 Context 文件和 Git 分支/比较/暂存提交/受控推送；破坏性操作均为精确二阶段确认。
- [x] Rux Native Secret Connection 管理明确保持 Electron Main-owned：TUI/stdio Host 不获得 `safeStorage` 解密能力，也不以凭据文件解析、Keychain Shell 抓取或明文存储换取表面对等；该安全例外已写入架构合同。
- [x] 已完成首版 Grok Build 风格 TUI 交互合同、真实 JSONL Host 运行、`--help/--version`、架构/安装/快捷键/发布文档，以及随 DMG/ZIP、NSIS、AppImage/DEB 打包的跨平台二进制准备。

## Goal 12：冲突协调、云能力与产品指标（后续）

- [x] 外部会话新增、修改、删除、重排和不确定匹配已有本地差异检测。
- [x] 当前产品明确限制为用户触发的本地 Projection，不误称实时双向同步。
- [x] 已实现 Native Session 多写入协调：桌面使用单实例锁，Desktop/stdio Runtime 对同一 Session 的活动 Run 加写入租约并以 `NATIVE_SESSION_WRITE_CONFLICT` fail closed；外部客户端风险明确显示，导入可保持只读、显式刷新差异或复制为新任务分支。
- [x] 已定义首批 Provider Adapter 支持矩阵、网络安全策略和跨版本迁移合同，并用重定向拒绝、URL 约束和未来 Store 版本 fail-closed 测试固化。
- [x] 已完成用户明确开启的跨设备/云同步设计合同，定义默认关闭、数据分类、端侧加密与设备密钥、不可变版本、分支冲突、删除/备份时限、独立同意和上线验证门槛；当前未实现任何同步传输。
- [x] 已实现首版本机成功指标卡，从持久化 Task/Run 事实计算完成率、中位耗时、成功 Task、失败/停止、权限决定和 Engine 分布；没有遥测或上传通道。
- [x] 已实现 Main-owned 跨启动本地事件 Store，覆盖 CLI 检测、首次/后续成功 Run、失败、重启恢复、导入/去重、继续、Handoff 分支和同 Session 错误恢复；只持久化固定事件、哈希身份和非敏感维度，设置页显示聚合计数，没有上传通道。

## Goal 13：正式发布与分发

- [x] `npm test` 覆盖 Renderer、Runtime、认证、持久化、Adapter、权限、Context、Git、Sites 和 TUI。
- [x] Web、Desktop、Runtime Host 和 TUI 构建通过。
- [x] macOS arm64 未签名应用可打包，并已完成真实桌面点击路径验收。
- [x] 已保存 Codex 风格对齐和真实运行的设计/验收证据。
- [ ] TODO（凭据阻塞）：提供真实 Apple Developer ID 签名身份；仓库配置和 fail-closed 门禁已完成，当前机器没有有效 identity。
- [x] 已实现 fail-closed 跨平台 Release Workflow：完整测试后构建 DMG/ZIP、NSIS、AppImage/DEB，macOS 强制检查签名输入、codesign、Gatekeeper 与 stapled notarization，产出 SHA-256/JSON Manifest，并经 `production-release` 人工环境门控；同时提供迁移、事故和回滚 Playbook。
- [ ] TODO（凭据阻塞）：注入真实 Apple Developer ID 与 App Store Connect 凭据，跑通并保存 macOS 签名、公证和恢复演练证据。
- [x] 已配置版本化安装包目标、跨平台 TUI 资源准备、Release Manifest、`CHANGELOG.md` Release Notes 模板和明确的手动升级/回滚合同；未签名产物不标记为正式发布。
- [x] 已实现 Main-owned 签名应用更新状态机：正式包从构建期 HTTPS Feed 配置读取更新，electron-updater 执行 SHA-512、平台签名和分阶段资格校验；下载与安装均由用户显式触发，安装前再次原生确认。新版本连续两次未达到健康检查点时，只接受回滚 Feed 精确指向上一健康版本的已签名包并自动恢复。无 Feed 或未签名 QA 包 fail closed，不发起更新请求。
- [ ] TODO（目标平台阻塞）：在 Windows/Linux 目标机完成桌面包、凭据库、终端和安全边界验收；本机无法把交叉构建当作目标机安全证明。
- [x] 已取得并保存官方版本同状态参考图，完成同尺寸视觉门禁；OS 限制下的真实包截图与精确 Browser viewport 证据配对记录，未从截图推断完整无障碍合规。

## Goal 14：项目看板、经验沉淀与受控演进（K1/L1/L2/E1）

- [x] 使用规范化 Git common-dir 与 WorkingCopy 身份聚合已授权目录；Task 保留具体执行根和分支。
- [x] 显式发现 Git worktree 元数据，授权根外工作副本必须确认后才加入 Project。
- [x] Main-owned Board Store 提供四个系统列、唯一 Task 卡片、需求卡片、Task 关联、拖拽/键盘移动、运行徽标与功能开关。
- [x] Board 自动规则只推进到进行中或待验收；手工移动后不会被自动规则覆盖，绝不自动完成。
- [x] Main-owned Improvement Store 从明确反馈和失败后恢复提取脱敏证据，去重生成可审查候选。
- [x] 改进中心支持项目规则、Skill、Workflow 的显式候选、证据/收益/风险审查、编辑后批准、拒绝、稍后处理和回滚。
- [x] 发布执行 Secret、权限、作用域和证据门禁，生成 Rux-managed 不可变资产版本；新 Task 固定 active 资产，既有 Task 不被改写。
- [x] 从持久化 Task/Run 事实记录资产采用与完成/失败/停止计数；缺少可执行隔离评测时明确标记 unknown。
- [x] 支持自定义看板列名称、增加自定义列和键盘可操作的列排序，同时保持稳定 stateId。
- [x] 删除 Task/Workspace 前显示 Board Task 卡片与需求关联影响；执行后保留需求卡片并清理失效关联。
- [x] 支持由 Rux 创建 worktree：Desktop 与 TUI 均使用两阶段确认，Runtime protocol v17 仅在仓库根使用结构化 Git argv 创建；现有目录、已占用分支、Git 元数据路径和未授权 Project 身份均 fail closed。
- [x] 支持资产导出预览与确认：Codex Skill/Workflow 按官方 `SKILL.md` 合同发布到 Project 或用户 `.agents/skills`，Rux 格式可导出到用户选择目录；完整文件 Diff、目标哈希、过期预览、symlink/越界检查和不支持类型降级均 fail closed。
- [x] 实现隔离 A/B 评测与保留集：Baseline/Candidate 各自使用无工具、无持久 Session 的临时 Codex/Claude 调用，按用户期望文本确定性评分；Candidate 不得回归且 Holdout 必须通过，失败阻止发布，同模型自评仅作 advisory。
- [x] 实现后台演进预算与策略：独立评测 Agent、每日/项目 Token、单次 Token/费用预留、每日费用上限、空闲/接电策略和立即暂停；默认开启但在 Agent、用例与预算齐备前不调用 Provider，用量、延迟、模型和未报告费用与普通 Run 分开保存。
- [x] Agent 指令候选固定提议时 Profile/Revision；确认发布追加新 Agent Revision，既有 Task 不变，新 Task/Handoff 使用刷新后的最新 Revision；候选过期时拒绝覆盖，回滚也通过追加恢复 Revision 完成。

## 汇总

- P0 核心闭环：已完成。
- P1 Workspace 会话接入：已完成。
- P2-E0 Auto 路由：已完成。
- P2-E1 Rux Native 核心编码闭环：已完成；已覆盖 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages，Provider 注册 OAuth 和跨平台沙箱仍受外部/平台条件阻塞。
- 正式公开分发：未完成；自动化发布流水线和签名应用内更新状态机已具备，剩余阻塞为真实签名/公证凭据、生产 HTTPS Feed 与跨平台目标机验收。
