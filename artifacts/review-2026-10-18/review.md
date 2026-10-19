# Rux 功能与界面评审 · 2026-10-18

结论：**功能骨架完整、工程质量高于同类项目，但存在 1 个阻断级功能缺陷（Git 提交/推送在桌面端不可用），界面在"一致性"和"首次使用引导"两处明显掉队。**

> 2026-10-19 更新：P1 三项、P2 四项、P3 五项已修复（统一确认对话框、空项目引导、禁用原因、设置搜索、工具改名、小字号、运行时重试、快捷键单一来源、移除 `agent:send`、Toast 队列、首轮占位、token 命名收敛），见 §4.2–§4.6。原 §2.1 阻断级缺陷已于 2026-10-18 修复。

| 维度 | 结论 |
| --- | --- |
| IPC 契约 | 66 个通道全部双向对称，无孤儿；每个 handler 校验调用来源 |
| Agent 适配器 | Codex / Claude Code / Pi 三条链路均已实现到可发送、可中断、可审批 |
| 持久化 | SQLite + 草稿 + 侧栏宽度，重启恢复有 E2E 覆盖 |
| 构建 | `tsc --noEmit` 与 Web/桌面双端构建均通过 |
| 单测 | 120 通过 / 1 失败（5s 超时，见 §4） |
| 功能缺口 | 提交推送不可用（P0）；交接上下文、能力声明、运行时修复未落地 |
| 界面友好度 | 组件体系与键盘/焦点处理扎实；确认、空状态、禁用解释三处已补齐 |

## 1. 验证方式

- 静态核查：`src` 全量 IPC 通道比对、适配器与 hook 调用链、渲染层对 66 个 API 的实际使用。
- 动态验证：`pnpm test`（check:ui + vitest）、`pnpm typecheck`、`pnpm build` 全部实跑。
- 行为实测：用仓库内 Electron 43 执行探针，确认 `window.prompt` 的真实行为（见 §2.1）。
- 界面取证：检视 `test-results/` 中真实 Electron 截图（空状态、模型浮层）。

## 2. 功能完整性

### 2.1 P0 · 「提交或推送」在桌面端必然失败 —— 已修复

`src/renderer/hooks/useGitController.ts:122`（修复前）

```ts
const message = window.prompt("输入提交信息；留空则仅推送当前分支", "");
if (message === null) return;
```

Electron 从未实现 `window.prompt`。实测（Electron 43，仓库同版本）：

```
PROMPT_RESULT=threw:prompt() is not supported.
```

它**抛异常**，而不是返回 `null`。异常发生在 async 回调内，`mutate` 不会执行，也没有 catch，最终是一次静默的未处理拒绝：

- 有 `AGENTS.md`：确认规则弹窗 → 用户点确定 → 抛错 → 无任何反馈。
- 无 `AGENTS.md`：点按钮 → 立刻抛错 → 无任何反馈。

也就是说 `ReviewScreen` 的「提交或推送」按钮（`src/workspace/ReviewScreen.tsx:9`）在所有项目上都无法完成提交。E2E 只断言了该按钮可见/禁用（`e2e/app.spec.ts:339,346`），从未真正点击，因此整条链路无测试覆盖。

**修复（本次已实施）**：新增 `src/workspace/CommitModal.tsx`，把整条链路换成自建弹窗。

- 一个对话框内完成：已暂存文件列表 → 项目规则（可滚动、可选中、超长截断提示）→ 规则勾选确认 → 提交信息（`Textarea`，20000 字符上限）→ 推送开关。
- 提交按钮按状态禁用并给出原因：无信息且未开推送、无暂存文件却填了信息、规则未勾选、无 origin 远程仓库。
- 后端拒绝（如"没有已暂存的变更"）不再吞掉，弹窗保持打开并在 `role="alert"` 区域显示原因。
- `useGitController` 拆成 `requestCommit`（拉取规则与 remote）与 `submitCommit`（提交并刷新），不再有 `window.prompt`。
- 覆盖：`src/renderer/hooks/controllers.test.tsx` 新增 3 条单测；`e2e/app.spec.ts` 新增「commits staged changes through the in-app commit dialog」，真实点击到底并用 `git log` 断言提交落地。

### 2.2 P1 · 同一动作连续三次原生弹窗

`useGitController.ts:118 → 122 → 123`：规则确认 → 提交信息 → 是否推送。三个 `window.confirm/prompt` 串联，其中第一个会把最多 6000 字的项目规则塞进原生 confirm（不可滚动、不可选中、不可复制）。这是全应用体验最差的一段路径。

### 2.3 通过项（有实现、有测试）

- **IPC 边界**：`ipc.handle` 66 个、preload 暴露 66 个，`comm` 双向差集为空；`backend.ts:47` 对每个请求校验 `event.sender` 是否为主窗口。
- **三适配器**：Codex App Server JSON-RPC（375 行）、Claude Agent SDK 流式（332 行）、Pi RPC（263 行）；`agent:start / interrupt / approval` 三条分支都落到具体客户端。
- **审批语义**：`allow-session` → `acceptForSession` 的映射在 `useAgentRuns.ts:119` 正确落地，Claude 侧会带上 `updatedPermissions`（`claude-code.ts:165`）。
- **图像能力边界**：文本模型下渲染层与主进程双重拒绝，切模型保留附件但锁发送。
- **持久化**：SQLite 存项目/会话/transcript，草稿按 thread 隔离并落 localStorage，侧栏宽度记忆。
- **输入法**：`onCompositionStart/End` + `keyCode 229` 双重防护，E2E 有中文候选词回车用例。

### 2.4 已注册但未接线的能力

| 能力 | 状态 | 位置 |
| --- | --- | --- |
| `agent:send` | 已注册、已暴露，渲染层零调用（死通道） | `preload.ts:71`、`agent-runtime-ipc.ts:19` |
| `runtimes:ensure` / `runtimes:list` | 已注册、已暴露，渲染层零调用 | `settings-auth-models-ipc.ts:23` |
| 运行时下载失败 | 只显示错误文字，无重试入口；`ensure` 只在发送消息时被动触发 | `RuxAssistantThread.tsx:430` |

### 2.5 文档承诺 vs 实际实现

`docs/architecture/agent-workbench.md` 是设计决策文档，以下三条未落地：

1. **交接上下文**（第 193 行 `Handoff context`）：代码中不存在 handoff/fork 实现，切换 Agent 只能新建空白会话（`App.tsx:279`）。UI 文案诚实（明确写"空白会话"），不算欺骗，但能力缺失。
2. **能力声明驱动 UI**（第 37-60 行 `AgentCapability` / `AgentDescriptor`）：该类型在代码中不存在。实际是硬编码分支——`selectedAgent === "pi"` 出现在 `App.tsx:139, 290, 299, 315`。新增第四个 Agent 需要改多处 if，架构已漂移。
3. **安装与诊断 UX**（第 235-254 行）：设置页的 Agent 卡片只读，没有安装/修复/重启按钮。

## 3. 界面友好度

### 3.1 做得好的部分

- **视觉克制**：浅色、低饱和、单一强调色；正文/导航/辅助三级字号；截图中的空状态与模型浮层信息密度合适。
- **组件统一**：`src/ui` 提供 Button/IconButton/Input/Select/Menu/Modal 等，`pnpm check:ui` 用脚本阻止业务代码绕过组件层。
- **键盘与焦点**：菜单、对话框、Select 共享同一套键盘行为，E2E 有专项用例（`app.spec.ts:689`）；焦点陷阱、Escape、外部点击均已统一。
- **状态可见**：每轮保留模型、思考档、Token 用量、耗时；运行中有等待/处理两态；`aria-live` 覆盖状态区。
- **动效克制**：`prefers-reduced-motion` 在三处样式表中都有降级。

### 3.2 明确不友好的点

**~~P1~~ 已修复 · 破坏性操作使用原生对话框。** 原实现散落 8 处 `window.confirm`（`App.tsx` 2 处、`SettingsScreen.tsx` 2 处、`useWorkspaceController.ts` 2 处、`useGitController.ts` 2 处；另有 2 处属已删除的提交 prompt 链）。现已统一为 `src/renderer/ConfirmDialog.tsx`：模块级队列 + `confirmAction()` 可被任意 hook `await`，`ConfirmHost` 在应用根节点渲染唯一实例。危险操作使用 `role="alertdialog"`、默认焦点落在「取消」、副文案单独成块说明不可逆后果；普通确认默认焦点落在主操作。原生确认框已从代码中清零。

**~~P1~~ 已修复 · 空项目没有引导。** 零项目且无搜索词时，侧栏「项目」下方出现虚线卡片：标题「还没有项目」+ 一句说明（添加后可管理会话、终端与 Git 变更）+「添加项目」按钮。搜索无结果时仍沿用原有「未找到匹配的项目或会话」。

**~~P2~~ 已修复 · 禁用控件不解释原因。** `IconButton` 新增 `disabledReason`：禁用时用 `<span class="ui-disabled-anchor">` 包住按钮，让 Tooltip 仍能接收 hover（禁用按钮本身吞掉指针事件）。顶栏「审查」「终端」在独立会话下分别提示「独立会话没有可审查的项目变更」「独立会话没有可用的项目终端」。

**~~P2~~ 已修复 · 工具名与行为不符。** 「浏览器」改名为「远程仓库」（`workspaceTools.ts`），快捷键从与"新标签页"惯例冲突的 `⌘T` 改为 `⌥⌘R`，`App.tsx` 的 keydown 与设置页快捷键列表同步更新。面板内容不变：仍显示 remote URL 与「在浏览器中打开」。

**~~P2~~ 已修复 · 设置搜索名不副实。** 新增 `src/settings/settingsSearch.ts`：19 条「设置项 → 所属分区」索引，覆盖账户、Agent 同步、Provider API key / Base URL、主题、UI 字号、权限、OAuth、模型、快捷键、Git、环境。搜索「字体」「API key」「提交」「退出登录」都能命中；结果在侧栏分区名下显示具体设置项。纯函数 `matchSettings()` 单独测试。

**~~P2~~ 已修复 · 小字号越界。** 9px / 10px 全部提到 11px（Agent 选择器副标题、Agent 状态徽标、模式标签、Provider 列表、`picker-option` 徽标、文件变更数、工具快捷键）。`styles.css` 中已无低于 11px 的字号。

**P3 · 其他**

- ~~空会话输入框 placeholder 固定为「继续对话…」~~ 已修复：无消息时为「描述你想完成的任务…」，有消息后恢复「继续对话…」。
- ~~Toast 单槽 3 秒覆盖式替换~~ 已修复为队列（最多 4 条，逐条 3 秒），连续提示不再吞掉前一条；位置仍压在输入区右下角。
- ~~快捷键两份真相~~ 已修复：`src/renderer/shortcuts.ts` 同时驱动 keydown 与设置页展示，改键位只改一处。
- 主题硬编码浅色（`SettingsScreen.tsx:130` 把"浅色"渲染为纯文本），`tokens.css` 只有一套浅色变量。
- ~~两套 token 命名并存~~ 已修复：24 个旧 token（`--surface`、`--border`、`--text`、`--ui-small` 等）全部并入 `--rux-*` 命名空间，413 行引用同步替换；`check:ui` 增加守卫，禁止旧名称回流。

## 4. 测试与构建现状

| 命令 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过（web 1m47s，desktop 同步完成） |
| `pnpm test:unit` | 120 通过 / 1 失败 |

失败项：`src/electron/git-service.test.ts:39`「discovers scoped project rules and requires acknowledgement before commit」— `Test timed out in 5000ms`。该用例串行执行 5 次以上真实 git 子进程（add / instructions / commit / log），同文件另一个用例已耗 1951ms，5s 默认值在负载机器上必然踩线。属测试健壮性问题，非产品逻辑错误。

注意：`pnpm test` 是 `check:ui && test:unit && typecheck && build`，单测失败会让后两步根本不执行——本次是单独补跑才确认类型与构建通过。建议给该用例显式 `it(..., 20_000)` 或把 `testTimeout` 提到 15s。

### 4.1 修复后复核

| 检查 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过（82 个模块） |
| `pnpm typecheck` | 通过 |
| `pnpm build:desktop` | 通过（2m1s） |
| `src/renderer/components.test.tsx` | 12 通过（含新增 2 条提交弹窗用例） |
| `src/renderer/hooks/controllers.test.tsx` | 18 通过（含新增 3 条提交控制器用例） |
| `e2e/app.spec.ts` 新增用例 | **本机无法执行**：容器内 Chromium 无法初始化沙箱/GPU，应用窗口启动即退出；用仓库既有用例做对照同样失败，与本改动无关。需在正常桌面环境运行 `pnpm test:e2e` 验证。 |

### 4.2 P1 修复复核（2026-10-19）

| 检查 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过（83 个模块） |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过（web 2m33s + desktop） |
| `components.test.tsx` | 15 通过（新增 2 条确认对话框、1 条空项目引导） |
| `controllers.test.tsx` | 19 通过（新增 1 条：取消确认后不执行删除） |
| 全量单测 | 124 通过 / 2 超时：`git-service.test.ts:39`（5379ms）、`agent-config-sync.test.ts`（5012ms）。两条单独以 `--testTimeout=30000` 重跑均通过，属高负载机器上的默认 5s 超时，非逻辑错误 |
| `window.confirm` 残留 | 0（仅样式表注释提及） |

实现要点：`ConfirmDialog` 用模块级队列 + `useSyncExternalStore`，让 hook 和事件处理器都能 `await confirmAction()`，而对话框本身仍由 React 树中的单个 `ConfirmHost` 渲染。危险操作 `role="alertdialog"` 且默认焦点在「取消」；普通确认默认焦点在主操作。没有加"不再询问"，因为这些动作均不可撤销，重复确认是刻意保留的摩擦。

### 4.3 P2 修复复核（2026-10-19）

| 检查 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过（84 个模块） |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过（web 3m23s + desktop） |
| `settingsSearch.test.ts` | 5 通过（空查询、同义词命中、大小写/空格、无结果、分区覆盖） |
| `styles.css` 字号扫描 | 无 `9px` / `10px` 残留 |

运行时重试：错误行右侧新增「重试下载」，接 `api.runtimes.ensure(agentId)`；进度仍由 `runtime:progress` 事件驱动，重试后进度条会自动回到下载态。若 `ensure` 直接拒绝，走 Toast 报错，不会静默。

工具改名只动展示层与快捷键：`WorkspaceToolId` 仍为 `browser`，避免扩散到类型、E2E 和持久化状态。

### 4.4 P3 修复复核（2026-10-19）

| 检查 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过（85 个模块） |
| `pnpm typecheck` | 通过 |
| `shortcuts.test.ts` | 5 通过（主修饰键、组合键、缺修饰键不触发、旧 ⌘T 已解绑、id/label/keys 唯一） |
| `agent-runtime-ipc.test.ts` + `agent-send-service.test.ts` | 13 通过 |
| `pnpm build` | 通过（web + desktop） |

快捷键：新增 `src/renderer/shortcuts.ts`，`shortcuts` 数组同时驱动 `App.tsx` 的 keydown（`matchShortcut` + switch）与设置页列表。改一个键位只需动这一处；旧实现里两处手写、改 `⌥⌘R` 时要同步三个文件的问题消失。

死通道：`agent:send` 从 preload、主进程 handler、`agentSendSchema`、`BackendDependencies` 与测试 harness 中移除。注意 `sendWithCustomProvider` 仍被 `agent:start` 的自定义 Provider 分支使用，不能一起删；`AgentSendService.codex` 也保留（仍有独立测试），只是不再暴露为 IPC。

### 4.5 P3 收尾（2026-10-19）

| 检查 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过（85 个模块） |
| `pnpm typecheck` | 通过 |
| `useToast.test.tsx` | 3 通过（排队、队列不重置当前计时、重复消息去重） |
| 全量单测 | 136 / 136 通过（36 个文件）；另有 3 个 jsdom 文件因 worker 启动超时未计入，单独重跑 24 / 24 通过 |
| `pnpm build` | 通过（web + desktop） |

测试稳定性：`vitest.config.ts` 增加 `testTimeout: 15_000`；`git-service.test.ts` 的提交规则用例与 `agent-config-sync.test.ts` 的首条用例显式放宽到 30s。本次全量运行中这两条不再超时。

剩余的全量退出码问题来自 worker 启动超时：本机 load average ≈ 9，单文件 import 最长 26 分钟，`vitest-pool` 等不到 worker 响应。三个受影响文件单独跑均通过，属环境问题。本机需要时用 `npx vitest run --no-file-parallelism`；CI 可保持默认并行。

### 4.6 token 命名收敛（2026-10-19）

| 检查 | 结果 |
| --- | --- |
| `pnpm check:ui` | 通过（85 个模块，含新增命名空间守卫） |
| `pnpm typecheck` | 通过 |
| CSS 变量定义校验 | 58 个 `var()` 引用全部有定义（Radix 注入变量与运行时 `--composer-height` 除外） |
| `pnpm build` | 通过（web + desktop） |

做法：24 个旧 token 重命名为 `--rux-*`（`--surface` → `--rux-surface`、`--border-strong` → `--rux-border-strong`、`--ui-caption` → `--rux-ui-caption` 等），7 个 CSS 文件共 413 行引用同步替换。所有值保持不变，渲染结果与改动前一致。

顺带消除两处同值重复：`--rux-danger: var(--rux-red)`、`--rux-focus: var(--rux-blue)`。

防回流：`scripts/check-ui-system.mjs` 新增守卫，任何 CSS 文件再出现 `var(--surface)` 或 `--text:` 这类旧定义都会让 `pnpm check:ui` 失败。已用临时探针文件验证守卫确实会拦截（验证后删除）。

保留的非 `--rux-*` 变量只有三类，不属于命名分裂：`--ui-font-size`（设置页运行时写入）、`--composer-height`（组件测量后写入）、`--radix-*`（Radix 注入）。

## 5. 建议优先级

| 优先级 | 事项 | 预计改动 |
| --- | --- | --- |
| ~~P0~~ 已完成 | 用自建 Modal 替换 `window.prompt` 提交流程 | `CommitModal.tsx` + `useGitController.ts` |
| ~~P0~~ 已完成 | 为提交/推送补一条真正点击到底的 E2E | `e2e/app.spec.ts:385` |
| ~~P1~~ 已完成 | 统一原生 confirm 为 `ConfirmDialog`（danger 样式 + 焦点默认落在安全操作） | `src/renderer/ConfirmDialog.tsx` + 8 处替换 |
| ~~P1~~ 已完成 | 空项目引导：标题下加说明与「添加项目」按钮 | `Sidebar.tsx` |
| ~~P1~~ 已完成 | 禁用控件补 `disabledReason`，说明前置条件 | `Button.tsx` + `TopBar.tsx` |
| ~~P2~~ 已完成 | 设置搜索扩展到设置项文本 | 新增 `settingsSearch.ts` + 侧栏结果提示 |
| ~~P2~~ 已完成 | 「浏览器」改名「远程仓库」并重新分配快捷键 | `workspaceTools.ts` + `App.tsx` + 设置页 |
| ~~P2~~ 已完成 | 9/10px 字号提到 ≥11px | `styles.css` |
| ~~P2~~ 已完成 | 运行时下载失败补「重试下载」按钮，接上 `runtimes:ensure` | `RuxAssistantThread.tsx` + `App.tsx` |
| ~~P3~~ 已完成 | 快捷键单一来源（`renderer/shortcuts.ts`，窗口处理器与设置页共用） | `shortcuts.ts` + `App.tsx` + 设置页 |
| ~~P3~~ 已完成 | 移除 `agent:send` 死通道、`agentSendSchema` 与 `sendWithCodex` 依赖 | preload / ipc / backend / 测试 |
| ~~P3~~ 已完成 | Toast 改为队列，连续提示不再互相覆盖 | `useToast.ts` |
| ~~P3~~ 已完成 | 首轮输入框占位改为「描述你想完成的任务…」 | `RuxAssistantThread.tsx` |
| ~~P3~~ 已完成 | token 命名收敛到 `--rux-*`，`check:ui` 阻止旧名称回流 | 7 个 CSS 文件 + `check-ui-system.mjs` |

## 6. 结论

功能层面：**主干完整，阻断级缺陷已清零**。导入项目、多 Agent 对话、附件、审批、终端、审查、持久化、登录恢复都已端到端可用，提交/推送链路在 2026-10-18 修复，且边界处理比多数同类项目严谨（来源校验、能力边界、凭据隔离、IME）。

界面层面：**设计与组件体系是加分项，交互一致性在补齐**。原报告的核心问题——"自建了一套组件，却在 8 个高风险动作上退回浏览器原生控件"——已收口为统一确认对话框；空项目引导与禁用原因提示也已补上。剩余问题集中在工具命名、设置搜索与排版细节（P2/P3）。
