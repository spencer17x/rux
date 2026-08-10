# RUX 产品需求文档

| 字段 | 内容 |
| --- | --- |
| 状态 | Draft v0.1 |
| 日期 | 2026-08-10 |
| 阶段 | 产品探索 |
| 范围 | 仅讨论产品需求，不包含技术架构与实现决策 |

## 1. 产品概述

RUX 是一个面向开发者的 **Coding Agent Workbench（编程 Agent 工作台）**。

它围绕同一个软件项目和开发目标，统一承载不同 Coding Agent，让开发者可以在一个地方使用、切换、观察和控制 Agent，而不必在多个终端、应用和配置系统之间反复切换。

RUX 不是：

- 又一个通用 AI 聊天应用；
- 给现有 Agent 套一层 GUI；
- 只做模型切换的聚合器；
- 试图取代完整 IDE 的 AI 编辑器。

RUX 是 Agent 驱动开发的用户体验与控制层。

### 1.1 一句话介绍

> RUX 是一个统一使用、观察和安全控制所有 Coding Agent 的开发者工作台。

### 1.2 暂定口号

> One workspace. Every coding agent.

### 1.3 名称含义

RUX 可以解释为 **Runtime User Experience**。

这个名字对应产品最核心的承诺：Agent Run 不应该只是终端里一个不可理解的黑盒进程，而应该成为可见、可控、可审查、可恢复的用户体验。

## 2. 背景与问题

开发者正在同时使用越来越多的 Coding Agent、模型、Skills、MCP 和开发工具，但整体体验仍然高度割裂。

一个开发者今天可能需要：

- 在不同终端或应用中分别运行多个 Agent；
- 为不同 Agent 重复配置 Provider、Tools、Rules 和 MCP；
- 把任务交给另一个 Agent 时重新解释背景并重建 Context；
- 从大量聊天消息中猜测 Agent 当前到底在做什么；
- 切换到编辑器或 Git 客户端查看变更；
- 自己记录长任务还剩哪些步骤；
- 在 Agent 改坏代码后手动恢复项目状态；
- 在缺乏信息的情况下决定该使用哪个 Agent 或模型。

由此产生六个核心产品问题。

### 2.1 Agent 使用体验割裂

不同 Agent 拥有各自的会话、配置、使用习惯、权限机制和界面。开发者被迫成为这些工具之间的人工集成层。

### 2.2 Context 对用户不透明

用户通常不知道 Agent 当前掌握了什么、加载了哪些文件和规则、忽略了什么，以及 Context 为什么开始失效。

### 2.3 Chat 不适合承载复杂开发任务

消息适合沟通，却无法清楚表达开发目标、任务拆分、执行尝试、当前状态、待决策事项、验证结果和完成标准。

### 2.4 Agent 执行过程难以观察

用户需要知道 Agent 做了哪些动作、调用了什么工具、访问或修改了哪些文件、完成了哪些验证、遇到了什么阻塞，而不是只能阅读一段不断增长的对话。

### 2.5 委托缺少安全感和可逆性

当权限影响不清楚、Diff 难以审查、恢复成本较高时，用户不敢把更大的任务交给 Agent。

### 2.6 Agent 之间无法顺畅交接

任务从一个 Agent 切换到另一个 Agent 时，用户往往需要复制对话、重新说明目标，并手动重建 Context。

## 3. 产品假设

如果开发者能够：

1. 在同一个项目 Workspace 中使用多个 Coding Agent；
2. 查看并控制每一次 Run 的 Context；
3. 用结构化 Task 管理复杂工作，而不仅依赖 Chat；
4. 实时观察 Agent 的动作与结果；
5. 安全地审查、接受、拒绝和恢复变更；
6. 在不同 Agent 之间交接任务而不必从头开始；

那么他们会愿意把更大、更复杂、更有价值的开发任务交给 Agent。

RUX 成功的标志，是开发者无论最终使用哪个 Agent，都会先在 RUX 中开始和监督 Agent 驱动的开发工作。

## 4. 目标用户

### 4.1 核心用户

RUX 首先服务于 **Coding Agent 重度用户**。

他们通常：

- 每天在真实软件项目中工作；
- 熟悉终端、Git 和代码审查；
- 已经使用或评估过两个及以上 Coding Agent；
- 会把调试、实现、测试、重构和 Review 等工作委托给 Agent；
- 希望对复杂任务和长任务拥有更好的可见性与控制权。

### 4.2 次级用户

希望在团队内统一以下能力的软件团队：

- 项目规则与开发方法；
- 可复用 Skills；
- 允许使用的 Tools 和权限；
- 不同仓库中的 Agent 使用方式；
- Review、验证和恢复要求；
- 可重复的任务流程。

### 4.3 后续用户

需要集成、观察、比较或评估不同 Agent Runtime 的 Agent 开发者与平台团队。

### 4.4 初期不重点服务的用户

- 主要需求是通用 AI 问答的用户；
- 非技术型 No-code 自动化用户；
- 只想寻找 AI 代码编辑器的用户；
- 主要关注企业治理、配额和费用管理的大型组织。

## 5. 用户待办任务（Jobs to be Done）

### 5.1 核心任务

> 当我有一个有实际价值的开发目标时，我希望从一个 Workspace 中把工作交给合适的 Coding Agent，理解并控制它的执行过程，并在无需手动协调多个工具的情况下安全地接受结果。

### 5.2 支撑任务

- 当 Agent 开始执行时，我希望知道它获得了哪些项目 Context。
- 当任务持续较长时间时，我希望知道当前进度、剩余步骤和阻塞原因。
- 当 Agent 请求高风险操作时，我希望在批准前理解影响范围。
- 当代码发生变化时，我希望先查看 Diff 和验证结果，再决定是否接受。
- 当一个 Agent 不适合当前任务时，我希望无缝交给另一个 Agent 继续。
- 当 Agent 犯错时，我希望快速恢复到已知安全状态。
- 当某类工作反复出现时，我希望复用同样的 Skills 和 Tools。

## 6. 产品定位

### 6.1 主定位

> RUX 是一个 Coding Agent Workbench，同时提供原生 Agent 体验并兼容外部 Coding Agent。

产品关系是：

> **Workbench 为主，原生 Agent 为核心能力之一。**

RUX 的长期价值应来自统一 Workspace、Task、Context、Observability、Skills、Tools 和 Safety，而不能只依赖内置 Agent 是否最聪明。

### 6.2 竞争心智

RUX 不需要只通过“我们的 Agent 更聪明”来竞争。

它要把用户的问题从：

> 为什么我要再使用一个 Coding Agent？

转变为：

> 为什么我要分别管理所有 Coding Agent，而不是统一放在 RUX 中？

## 7. 产品原则

### 7.1 Project over Chat

产品最上层是开发项目 Workspace，而不是聊天窗口。

### 7.2 Goal and Task over Messages

Chat 用于协作沟通，但 Goal、Task、Run、Changes 和 Outcome 必须可以脱离消息流独立理解。

### 7.3 Observable, not theatrical

RUX 展示动作、工具调用、文件、进度、决策和结果，不伪装成展示 Agent 的私有思维链。

### 7.4 Context belongs to the user

用户应当能够查看、添加、移除、固定并理解重要 Context。

### 7.5 Safe delegation

Permission、Diff、Checkpoint 和 Restore 不是高级设置，而是核心产品能力。

### 7.6 Agent 与 Model 是不同选择

产品必须清楚区分 Agent 和 Model。用户不需要理解底层实现，但需要知道自己选择的执行方式及能力差异。

### 7.7 Progressive complexity

简单任务必须保持快捷。复杂控制仅在需要时出现，不能让日常工作被过度结构化拖慢。

### 7.8 One shared experience

不同 Agent 的能力可能不同，但在条件允许时，RUX 应提供一致的 Task、Context、Permission、Progress 和 Review 体验。

## 8. 核心产品对象

以下是用户可感知的产品概念，不代表技术架构。

| 对象 | 用户含义 |
| --- | --- |
| Workspace | 一个软件项目及其持续存在的 RUX 工作环境 |
| Session | Workspace 内一个完整的开发目标或一组相关工作 |
| Task | 有负责人、状态和结果的具体工作单元 |
| Run | 某个 Agent 对一个 Task 的一次执行尝试 |
| Agent | 负责执行 Run 的 Coding Agent |
| Model | Agent 允许选择时所使用的 AI 模型 |
| Context | 当前 Run 可获得的信息 |
| Skill | Agent 完成某类工作时可复用的方法与指导 |
| Tool | Agent 可以使用的本地或连接能力 |
| Artifact | 代码变更、报告、测试结果等有价值输出 |
| Checkpoint | 与 Agent 工作关联、可以恢复的项目状态 |

### 8.1 Session、Task 与 Run 的关系

Session 表示一个开发目标，可以包含一个或多个 Task。Task 可以有多个 Run，用于重试、继续、比较或切换 Agent。

示例：

```text
Session：改善交易页面性能

├── Task：定位渲染瓶颈
│   └── Run：Claude Code — 已完成
├── Task：优化 OrderBook 渲染
│   ├── Run：Codex — 已停止
│   └── Run：RUX Agent — 已完成
└── Task：Review 并验证变更
    └── Run：Claude Code — 已完成
```

## 9. 核心用户流程

### 9.1 打开 Workspace

用户打开或返回本地软件项目。RUX 恢复项目的 Sessions、Tasks、Context 配置、Skills、Tools 和最近 Agent 活动。

### 9.2 描述开发目标

用户用自然语言描述期望结果。RUX 将 Goal 独立保存，不让它淹没在后续聊天消息中。

### 9.3 创建或确认 Tasks

小目标可以只有一个 Task。复杂目标可以拆成多个 Task，用户可以在执行前或执行过程中接受、修改、删除或补充。

### 9.4 选择 Agent

用户手动选择 Agent，或接受 RUX 的推荐。选择界面需要解释相关优势与限制，而不是只展示一串名称。

### 9.5 查看 Run 设置

执行前，用户能够理解：

- 选中的 Agent；
- 适用时选中的 Model；
- 主要 Context；
- 启用的 Skills 和 Tools；
- 当前 Permission 策略。

### 9.6 观察执行过程

Run 执行期间，RUX 展示：

- 当前活动；
- 已完成动作；
- 读取或修改的文件；
- 使用的 Tools；
- Permission 请求；
- 问题与阻塞；
- 验证状态；
- 下一步预计动作。

### 9.7 必要时介入

用户可以：

- 回答 Agent 问题；
- 批准或拒绝操作；
- 调整 Context；
- 修改任务方向；
- 停止 Run；
- 把 Task 交给另一个 Agent。

### 9.8 Review 结果

Run 完成后，用户看到简洁结果：

- 改了什么；
- 为什么这样改；
- 影响了哪些文件；
- 完成了哪些验证；
- 哪些验证没有执行；
- 仍有哪些风险或后续工作；
- 可以执行哪些操作，例如 View Diff、Accept、Reject、Restore 或 Continue。

### 9.9 带着完整历史继续

Task、Run History、Context Decisions、Artifacts 和 Checkpoints 持续保留，后续工作无需手动重建 Session。

## 10. 功能需求

优先级定义：

- **P0**：验证核心产品假设必须具备；
- **P1**：核心流程成立后应重点补充；
- **P2**：后续扩展或高级能力。

### 10.1 Workspace

#### P0

- 将本地项目作为持续存在的 Workspace 打开。
- 展示最近 Workspace 及基本活动状态。
- 保存 Sessions、Tasks、Run History、Context 选择和项目偏好。
- 始终清楚展示当前 Workspace 与代码仓库状态。

#### P1

- 组织和搜索大量 Workspaces。
- 展示 Workspace 摘要与未完成工作。
- 支持可复用 Workspace 模板，但不强制固定项目结构。

### 10.2 Sessions、Tasks 与 Runs

#### P0

- 从开发 Goal 创建 Session。
- 创建、编辑、排序、完成、取消和重新打开 Task。
- Task 状态独立于 Chat Messages。
- 为 Task 选择 Agent 并启动 Run。
- 保存每次 Run 的结果和可观察活动。
- 重试 Task 时保留此前 Run History。
- 清楚区分 Waiting、Running、Blocked、Stopped、Failed 和 Completed。

#### P1

- 在保留相关 Context 和 History 的情况下，把 Task 交给另一个 Agent。
- 比较同一个 Task 的多个 Runs。
- 从 Run 结果或 Review 问题直接创建后续 Task。
- 在同一个 Workspace 中管理多个活跃 Tasks。

#### P2

- 并行执行互相独立的 Tasks。
- 将 Subtasks 委托给专门 Agent。
- 为重复开发工作保存可复用 Task 流程。

### 10.3 Agents 与 Models

#### P0

- 提供完整的原生 RUX Agent 体验。
- 至少支持一个外部 Coding Agent，以验证 Workbench 假设。
- 每次 Run 均可手动选择 Agent。
- 清楚区分 Agent Selection 与 Model Selection。
- 用用户语言解释相关能力差异。
- 明确展示不支持的能力和体验差异。

#### P1

- 支持更多外部 Coding Agents。
- 根据 Task 特征推荐 Agent，同时保留透明选择权。
- 支持 Workspace 级偏好及 Run 级覆盖。
- 在数据可靠时展示可比较的高层使用信息。

#### P2

- 根据用户批准的策略自动路由 Task。
- 比较不同 Agent 在相似 Tasks 上的表现。
- 支持团队批准的 Agent 与 Model 列表。

### 10.4 Context Control

#### P0

- 展示当前 Run 的主要 Context 来源。
- 区分 Project Instructions、Selected Files、Conversation、Skills、Tool Results、Git Changes 和 Pinned Material。
- 允许用户添加、移除和固定 Context。
- 在可能时解释重要 Context 被加入的原因。
- 当遗漏或不可用的 Context 影响任务时明确提示。
- Context 被压缩或发生实质变化时告知用户。

#### P1

- 提供易理解的 Context Size Breakdown。
- 比较不同 Runs 的 Context。
- 保存重复工作所需的 Context Sets。
- 推荐相关 Context，并允许用户接受或拒绝。

#### P2

- 根据 Task 和 Agent 行为自动优化 Context。
- 评估 Context 是否改善或损害任务结果。

### 10.5 Skills 与 Tools

#### P0

- 展示 Run 可用的 Skills 和 Tools。
- 将 Skill 解释为“怎么做”，将 Tool 解释为“能做什么”。
- 支持 Project Skills 与 Personal Skills。
- 允许用户启用或停用相关 Skills 和 Tools。
- 将 Tool Activity 纳入可观察的 Run History。

#### P1

- 支持团队分发 Skills。
- 展示一个 Skill 所依赖的 Tools。
- 在可能时提前发现 Run 缺少的能力。
- 为连接型 Tools（包括 MCP 能力）提供清晰体验，避免要求用户始终从协议概念理解产品。

#### P2

- 支持可发现、可控分享的 Skill Collections。
- 衡量 Skill 是否改善任务结果。

### 10.6 Observable Execution

#### P0

- 为每个 Run 展示实时 Activity Timeline。
- 默认展示有意义的动作，而不是原始内部日志。
- 展示读取文件、修改文件、执行命令、使用 Tools、请求权限和完成验证等活动。
- 清楚区分当前活动与已完成活动。
- Run 等待用户时必须明显提示。
- Run 完成或失败后提供简洁摘要。
- 不将该能力描述为暴露 Agent 私有思维链。

#### P1

- 为长 Run 提供筛选和分组视图。
- 汇总 Files Changed、Tool Calls、Elapsed Time 和 Verification Results。
- 将 Activity 与相关 Diff、Files、Artifacts 和 Decisions 关联。

#### P2

- 根据可观察 Events 回放历史 Run。
- 比较不同 Agents 和 Tasks 的执行模式。

### 10.7 Git、Diff 与 Checkpoints

#### P0

- Run 开始前展示项目状态。
- 将 Agent 产生的变更与对应 Run 关联。
- 提供聚焦的 Diff Review 体验。
- 区分 Agent Changes 与用户已有变更。
- 允许用户安全地 Accept、Reject 或 Restore Agent Work。
- 在重要变更前后创建易理解的 Checkpoint。
- 展示已执行的 Test、Lint、Type Check 等验证结果。
- 未执行验证时必须明确说明。

#### P1

- 按 Task、Run、File 或 Checkpoint Review Changes。
- 从 Review 问题直接创建后续 Task。
- 在结果仍然清晰安全时支持部分接受或恢复。

#### P2

- 从历史 Checkpoint Fork Task。
- 比较不同 Runs 产生的替代实现。

### 10.8 Permissions 与 Safety

#### P0

- 操作超出用户当前信任级别时请求批准。
- 用清晰语言说明操作内容、范围和可能影响。
- 支持单次批准或拒绝。
- 明确展示 Run 正在等待 Permission。
- 在 Run History 中保留 Permission Decision。
- 提供可靠的 Stop 操作。
- 不因为请求来自 Agent 就暗示操作一定安全。

#### P1

- 支持易理解的 Workspace Permission Preferences。
- 允许用户查看并撤销已记住的 Permission。
- 强调范围异常宽或具有破坏性的请求。

#### P2

- 支持团队级 Safety Policies 和 Audit Requirements。

### 10.9 TUI 与 Desktop 的产品关系

RUX 可以同时提供 TUI 和 Desktop，但二者解决的用户需求不同，不应机械复制界面。

#### TUI

重点是“快”：

- 键盘操作；
- 聚焦执行；
- Terminal 用户；
- 远程与 SSH 环境；
- 高频日常开发。

TUI 必须让 Active Task、Run State、Permission Request 和 Outcome 随时可见。

#### Desktop

重点是“看”：

- 多 Workspaces；
- 多 Sessions 和 Tasks；
- 多 Agents；
- Context；
- Trace；
- Diff 与 Review。

Desktop 应让复杂监督与多任务管理明显优于纯终端体验。

#### 产品要求

首个版本不要求 TUI 与 Desktop 完全功能对等，但它们必须共享一致的产品概念与 Task History。

## 11. MVP 范围

MVP 必须验证：统一 Workbench 是否明显优于分别使用多个 Coding Agent。

### 11.1 MVP 必须包含

- 持续存在的项目 Workspaces；
- Sessions、Tasks 与 Runs；
- 原生 RUX Agent 加至少一个外部 Coding Agent；
- 手动 Agent Selection；
- 可查看和调整的 Run Context；
- 可见的 Skills 与 Tools；
- Observable Activity Timeline；
- 清晰的 Permission Requests；
- File Changes 与 Diff Review；
- Checkpoints 与 Restore；
- Verification Results；
- 持久化 History 与 Outcome Summary；
- 一个打磨完整的主客户端体验。

### 11.2 MVP 明确不要求

- 覆盖大量 Agents 和 Models；
- 自动 Agent 或 Model Routing；
- 自主多 Agent 团队；
- 大规模并行执行；
- Replay、Benchmark 或正式 Eval；
- Team Administration 与 Enterprise Governance；
- Marketplace；
- TUI 与 Desktop 完全对等；
- 接近完整 IDE 的内置代码编辑能力。

## 12. 非目标

RUX 不应变成：

- 通用 AI 助手；
- 完整 IDE 替代品；
- 以 Provider 切换为主要价值的模型聚合器；
- No-code Workflow Builder；
- Git Hosting Service；
- 通用项目管理应用；
- 展示私有思维链的界面；
- 缺少统一开发流程的技术概念集合；
- 移除用户有效控制权的自主 Agent Swarm。

## 13. 体验要求

Run 进行到任何时刻，用户都应该能回答：

1. 当前正在处理哪个 Goal 和 Task？
2. 哪个 Agent 负责执行？
3. Agent 现在正在做什么？
4. 它已经完成了什么？
5. 它拥有哪些 Context、Skills 和 Tools？
6. 它是否正在等待我？
7. 哪些文件或项目状态发生了变化？
8. 已经完成哪些验证？
9. 我现在可以 Accept、Reject、Stop 或 Restore 什么？

默认体验负责总结复杂性，详细证据按需展开。

## 14. 成功指标

早期阶段应通过用户行为和信任衡量价值，而不是使用消息数量等表面指标。

### 14.1 Activation

- 新用户打开 Workspace、启动 Run、Review Outcome，并有意识地 Accept 或 Reject 结果。
- 用户无需阅读大量文档，就能理解 Session、Task、Run、Agent 和 Model 的区别。

### 14.2 Core Value

- 用户再次回到 RUX 开始新的开发任务。
- 用户通过两个及以上支持的 Agents 完成有实际意义的 Tasks。
- 用户通过 Task History 或 Handoff 延续工作，而不是在其他工具中手动重建 Context。
- 用户在接受重要变更前查看 Activity 和 Diff。

### 14.3 Trust and Safety

- 用户能明确说出发生了什么变更、完成了什么验证。
- 用户能从不理想的 Run 中恢复，而无需手动清理项目。
- 用户能够理解 Permission Requests，而不是习惯性全部批准。
- RUX 不会把用户已有变更错误标记为 Agent 产生的变更。

### 14.4 最强定性信号

> 我不想再分别打开多个终端和应用来管理 Coding Agent。

## 15. 产品风险

### 15.1 多 Agent 需求可能被高估

用户可能更愿意使用一个足够优秀的 Agent。MVP 必须验证真实跨 Agent 使用，而不能预设“支持更多 Agent”天然有价值。

### 15.2 结构化可能增加摩擦

Sessions 和 Tasks 有利于复杂工作，却可能拖慢小需求。RUX 必须保留简单任务的快速路径。

### 15.3 Context 可见性可能使用户过载

只有当默认展示足够清晰且可操作时，详细 Context Control 才有价值。

### 15.4 外部 Agent 能力不一致

不同 Agent 未必支持相同控制或证据。RUX 必须诚实表达差异，不能制造虚假的一致性。

### 15.5 Permission 可能沦为噪音

请求过多会让用户形成无脑批准习惯。Permission 必须范围清楚、容易理解且真正有意义。

### 15.6 原生 Agent 可能模糊定位

强大的原生 RUX Agent 很有价值，但不能让产品失去 Workbench-first 的差异化。

## 16. 待验证的产品问题

1. 哪类 Coding Agent 重度用户最强烈地感受到工具割裂？
2. 用户是否自然地用 Session 和 Task 组织复杂开发工作？
3. 用户在什么情况下希望手动选择 Agent，什么情况下接受推荐？
4. 哪两个 Agent 足以验证初期 Workbench 假设？
5. 哪些 Context 信息必须默认展示，哪些应放入 Inspector？
6. 哪类 Permission Requests 能真正建立信任，而不是造成打扰？
7. 以 TUI 为主的 MVP 能否充分展示 Context、Trace 和 Diff 价值？
8. Desktop 在什么阶段会成为核心体验的必要组成部分？
9. Agent Handoff 必须保留哪些信息，才能真正做到无缝继续？
10. 用户最看重的是速度、质量、可见性、安全性，还是减少协调成本？

## 17. 建议的需求探索

在确定实现方案前，建议完成：

- 访谈 8–12 名同时使用至少两个 Coding Agent 的开发者；
- 观察真实 Debug、Implementation 和 Review 工作流；
- 测试 Workspace、Session、Task 和 Run 的概念是否容易理解；
- 测试 Context Inspector 和 Permission Request 原型；
- 对比 RUX 流程与多个独立终端 Agent 的使用体验；
- 验证用户是否会在真实任务中执行 Agent Handoff。

探索阶段的结果应当是收窄 MVP，而不是继续扩大功能清单。

## 18. 当前产品决策摘要

- **产品名称：** RUX
- **产品类别：** Coding Agent Workbench
- **核心用户：** Coding Agent 重度用户
- **最高层对象：** Project Workspace
- **核心工作单元：** Task
- **核心执行记录：** Run
- **核心差异：** Unified Agents、Controllable Context、Observable Execution、Safe Recovery
- **产品关系：** Workbench 为主，原生 Agent 为核心能力之一
- **当前约束：** 先验证产品需求，不提前确定架构与实现

