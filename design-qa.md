# Rux · 单行落款 UI 验收

final result: passed

用户选择的是最近一轮设计中的第 2 张「单行落款」：正文优先，每轮的 Agent、模型、思考模式、Token 和耗时在回复末尾呈现为一行辅助文字。文件变更和用量明细按需展开。

## 视觉依据与实现证据

- 选图：[selected-design.png](artifacts/single-line-signature/selected-design.png)，1487 × 1058 像素。
- 最终原生实现：[signature-desktop.png](artifacts/single-line-signature/signature-desktop.png)，1440 × 1024 像素；测试显式使用 1440 × 1024 CSS viewport、1× 密度，避开 macOS 实体屏幕对窗口高度的限制。
- 窄窗：[signature-narrow.png](artifacts/single-line-signature/signature-narrow.png)，900 × 650 CSS px，1×。
- [并排对照页](artifacts/single-line-signature/comparison.html)同时显示来源图和原生实现，并包含正文/落款局部区域；[最终配对截图](artifacts/single-line-signature/comparison-final.jpg)。来源等比缩到 1440px 宽，约 1024.6px 高，没有拉伸图像。
- 浏览器实际页面为 `http://127.0.0.1:5173/?preview=signature`，使用明确的示例对话与 Token 数据；原生测试也使用隔离的确定性数据。原生截图用于清晰的排版细节核对，浏览器页面用于交互和控制台检查。
- 场景：左侧项目栏展开、两轮已完成回复、第一轮 Sol/高思考、第二轮 Astra/极高思考、文件明细默认关闭、输入框空白。系统交通灯由 macOS 绘制，不包含在 Electron 页面截图中。

## 对照迭代

1. [初版原生截图](artifacts/single-line-signature/signature-desktop-before-qa.png)与[初版配对证据](artifacts/single-line-signature/comparison-before-qa.jpg)显示：正文和落款字号小于选图，导致文字占宽和段落节奏不一致（P2）。已调大桌面正文、落款和导航字号，并调整段落/轮次间距、输入框高度；最终原生图及配对图已复核。
2. 新增侧栏底部设置行后，账户弹窗曾覆盖账户按钮（P2）；已抬高弹窗，原生 E2E 验证再次点击关闭、Escape、外部点击和设置入口。
3. 导航旧样式覆盖了新选中颜色，并隐藏子会话图标（P2）；已修正覆盖关系，最终截图中会话图标和淡蓝选中态可见。

没有剩余的可操作 P0/P1/P2 问题。

## 五项视觉检查

- 字体：使用系统 sans / 中文字体回退；大桌面正文约 20px、落款 18px，随现有字号设置缩放；窄对话区降为正文 16px、落款 12px，进一步收窄时正文跟随基础字号。数字使用等宽数字排布，常见模型名称和五项字段没有裁切。
- 布局：默认侧栏 300px，仍可拖动和键盘调整并记住宽度；正文与输入框共享 960px 上限。落款无统计卡、无图标队列，复制按钮独立靠右。实际控件留有点击空间；窄窗允许在字段之间换行，输入工具在必要时排成两行。
- 颜色：白色主面、浅灰侧栏、淡蓝用户消息和导航选中态；落款使用较深的灰蓝色保持对比。错误/未完成/权限状态仍保留语义颜色。
- 图像与图标：Rux 蓝色标记按选图生成，保存为 [rux-mark.png](src/assets/rux-mark.png)，透明背景；其他图标使用现有 Phosphor 图标库，未用手绘 SVG 或 CSS 替代图像。
- 文案与内容：五项数据直接可见，Token 点击后显示明细；缓存和思考按输入/输出的子集展示，不重复相加。对话、侧栏和菜单文案仍基于真实项目、会话和 Agent 状态。

## 实际数据与持久化

- 发送时保存当轮 Agent、模型、推理档位和模式快照；运行时报告实际模型或改道时更新该轮，后续切换设置不会改写已完成回复。
- Codex：处理 `thread/tokenUsage/updated`，用线程累计计数的差值汇总本轮多次调用；首次缺少基线时使用该次已报告调用，重复通知不重复累计，旧轮通知不污染当前轮。
- Claude Code：读取当前 query 的 `modelUsage`；包括缓存读取/写入和查询管道的调用，按每个 query 的独立生命周期记录。流式期间按消息 ID 去重。
- Pi：流式用量采用覆盖式快照；完成时读取 session stats，并扣除本轮开始前的计数，覆盖工具和压缩用量。
- 自定义 Responses API：记录实际返回模型和 usage，标记为「自定义 API」，不冒充原生 Codex 调用。
- SQLite 单独保存白名单运行元数据，通过原生 turn/message 标识与 Agent 历史重新关联；不复制完整原生会话作为第二份历史。删除会话时级联删除元数据。
- 原生历史无法提供的旧模型、思考档位、Token 或耗时标记为未记录，不套用当前模型、不伪造零值。

参考接口依据：项目固定的 Codex 0.154.0 生成协议、Claude SDK 0.3.245 类型注释、Pi 0.84.3 随包 RPC 文档，以及 [Codex App Server 官方文档](https://developers.openai.com/codex/app-server)。本轮没有额外发起付费模型请求。

## 验证

- 107 项单元测试通过：含缓存/思考不重复计数、累计用量差分、通知去重、实际模型更新、原生历史关联、数据库级联清理、Responses 标准返回结构。
- 13 项原生 Electron E2E 通过：含换模型后旧轮信息不变、用量弹窗、重启恢复、1440/900px 布局，以及原有菜单、权限、图片、Git 和 PTY 流程。
- 类型检查、Web/desktop 构建、`pnpm package` 和 `git diff --check` 通过。
- In-app Browser 验证：Token 明细、Escape 和外部焦点、模拟发送生成新落款，前两轮的模型及统计不变；控制台没有 error。
- 本地桌面包：`release/mac-arm64/Rux.app`，未签名。

## 保留差异与后续细节

- 页面保留 Rux 已有的网页搜索、Agent 模式、语音和面板控制；空输入时发送按钮按实际状态禁用。选图中的装饰性用户头像未增加。
- 用户、项目和分支名称来自当前数据；原生测试中的空 Git 仓库可能显示未解析分支，浏览器示例展示 main。
- Rux 标记与生成图有细微形状差异，属于后续可微调的 P3。没有新增远程发布或未实现的 Agent 能力入口。


## Rux UI 组件层收敛 · 2026-09-12

final result: passed

本轮以既有「单行落款」工作台为视觉基线，收敛基础组件与交互，未更换视觉方向。实现说明见 [UI_SYSTEM.md](UI_SYSTEM.md)。

- 直接依赖：Radix UI 1.6.7、Phosphor React 2.1.10；业务经 `src/ui` 使用，保持既有 assistant-ui 运行机制和原生 IPC 边界。
- 统一基础件：Button/IconButton、Input/Textarea/Slider、Select、Switch/Checkbox、SegmentedControl、Tabs、Menu/ContextActions、Popover/AnchoredPopover、Modal、ChoiceList/NavItem。
- 图标：统一 AppIcon 入口、21 个核心语义名及兼容名称，12/16/20/24/32px 尺寸，outline/solid/strong 变体；品牌与权限图片例外有明确入口。
- 全部主题变量集中到 `src/ui/tokens.css`。旧样式清理了 105 条无效或重复规则、384 条重复/旧基础控件声明；审计计数见 [css-audit.json](artifacts/ui-system/css-audit.json)。
- `pnpm check:ui` 已接入 `pnpm test`，检查 69 个业务模块的库入口、原生控件、浮层监听、Tooltip 和图标尺寸边界。

### 实际页面验证

- [组件展示页截图](artifacts/ui-system/components-gallery.jpg)：1280 × 1000 CSS viewport，验证四种按钮变体、加载/禁用、输入错误、Select、开关、复选框与分段选择。
- 按钮实测高度严格为 28、32、40px；图标切换到 lg 后实测统一为 24px。
- [图标展示页](artifacts/ui-system/icons-gallery.jpg)支持尺寸和变体切换；[720px 窄屏](artifacts/ui-system/gallery-narrow.jpg)切换为单列且无横向溢出。
- 验证 Menu 方向键跳过禁用项、菜单打开确认弹窗、Escape 返回菜单触发按钮、表单弹窗输入和保存；控制台无 error/warn。
- 原生工作台截图：[1440px](artifacts/ui-system/workbench-desktop.png)、[900px](artifacts/ui-system/workbench-narrow.png)。单行落款、项目栏、消息输入及现有操作保持可用。

### 回归与修复

- 初次原生回归发现菜单名称被触发按钮的 aria-labelledby 覆盖、旧按钮查询未适配 radio/menuitem/tab 角色，以及标题栏控件需要明确 no-drag；均已在共享层或测试语义中修复。
- 快速从 Agent 模式切到模型时，旧浮层关闭会把焦点抢回旧按钮；共享层现在识别新浮层/弹窗并交接焦点，避免业务重复安装监听器。
- 菜单/右键菜单打开重命名后，关闭对话框可返回正确来源；在已有对话框内部关闭菜单也不会改写外层返回目标。
- assistant-ui 的发送按钮通过 asChild 组合 IconButton，运行时的禁用状态留在父控件上；空草稿不会变成可发送状态。

### 最终检查

- 109 项单元测试通过；禁用 asChild 链接不会执行子动作，对话框优先聚焦与 Escape 返回有专项回归。
- 14 项原生 E2E 通过，覆盖原有 Agent 选择/权限、图片、Git、PTY、Token 落款和重启恢复，新增共享右键菜单、对话框、Select 的键盘/焦点验证。
- 一轮默认高并发全量测试中，两项 Git 用例触发原有 5 秒超时；降低到 2 个 worker 后，全量 109 项通过，没有放宽超时或跳过用例。受影响的 UI 专项在最后改动后另行通过。
- 类型检查、Web/desktop 构建、`pnpm package`、`git diff --check` 通过。桌面包仍为本地未签名 arm64 包。

没有剩余的阻断性交互或布局问题。组件展示页仅在开发模式开放；历史独立演示和原生系统窗口属于明确保留的边界。

## 2026-09-12 — 模型选择器与胶囊滑杆

**Visual target**

- Source visual truth: `artifacts/model-picker-capsule/selected-design.png`，用户确认的第 3 版布局与指定胶囊滑杆的合并稿。
- Slider reference: `artifacts/model-picker-capsule/slider-reference.png`。
- Implementation: `http://127.0.0.1:5173/?preview=signature`，真实工作台组件与浏览器预览数据。
- State: GPT-6 Astra，极高（六档中的第 4 档），快速模式关闭，模型浮层展开。

**Evidence and normalization**

- Source image: 1444 × 1089 pixels。源图浮层区域约为 `(179, 174, 1100, 720)`；以约 0.325 的比例归一到 358 CSS px 宽，不比较源图外围的展示留白。
- Desktop viewport / screenshot: 1280 × 720 CSS px / 1280 × 720 pixels。最终浮层内容 356 × 234 CSS px，含外层边框 358 × 236 CSS px，位置 `(815, 394)`。
- Narrow viewport / screenshot: 900 × 650 CSS px / 900 × 650 pixels。内容位置 `(436, 325)`，356 × 234 CSS px；没有水平溢出，输入工具栏及发送按钮可见。
- Full-view evidence: `artifacts/model-picker-capsule/workbench-desktop-final.jpg`、`workbench-narrow.jpg`。
- Focused, combined comparison: `artifacts/model-picker-capsule/comparison-final.jpg`。`comparison.html` 使用原始源图和实际完整截图，在相同浮层宽度下通过 CSS 裁切并排展示；没有用重新绘制的 UI 替代截图。
- 浏览器截图按 1 CSS px 对应 1 输出像素记录；JPEG 截图与源 PNG 在细小文字的抗锯齿和压缩上有轻微差别，不据此判断字体错误。临时视口设置已恢复。

**Comparison history**

1. 首轮 `comparison-initial.jpg`：浮层包含边框高 244 px，比归一后的确认稿约高 10 px。底部间距偏松，记录为 P2 布局节奏差异。
2. 修正 `.model-picker-footer` 顶部间距 20 → 16 px，浮层底部内边距 16 → 12 px。
3. 重新截图并在 `comparison-final.jpg` 并排复查：含边框高 236 px；标题、思考强度、轨道、标签和底部操作保持同一对齐关系。无剩余 P0/P1/P2 问题。

**Required fidelity surfaces**

- Fonts / typography: 复用系统中文字体与 Rux 字号；模型标题 15 px / 600，正文 14 px，档位说明 12 px。层级和换行符合确认稿；长模型名允许省略并提供完整 title，模型清单保留完整名称。源图模型标题约 16 px，与现有产品字号的约 1 px 差异属于 P3。
- Spacing / layout: 使用统一 358 px 浮层宽度与 12 px 圆角。24 px 胶囊轨道、28 px 白色圆滑块；刻度和标签按同一滑块中心轨迹定位。保留顶部模型切换和底部快速开关 / 恢复默认。
- Colors / tokens: 轨道蓝色 `--rux-slider-accent: #3b80f7`、未填充轨道 `#e9e9e9`、白色滑块，与用户指定滑杆一致；不随最高档变成另一套色系。其余使用既有中性色、边框与阴影 token。
- Image / icon fidelity: CPU、闪电、箭头来自统一 Phosphor 图标入口。该浮层没有需要生成的装饰位图；轨道与刻度是可操作的原生 range 控件视觉层。
- Copy / content: 保留 GPT-6 Astra 完整名称，六档为轻度 / 中 / 高 / 极高 / 最高 / Ultra；“切换”“快速模式”“恢复默认”均可操作。移除重复的“全部模型”入口。模型与档位来自当前 Agent 目录；无速度能力时隐藏开关，单档模型保留不可调说明。

**Interaction and verification**

- `pnpm check:ui`：69 个生产模块边界检查通过。
- `pnpm test:unit --maxWorkers=2`：109 项通过。
- `pnpm typecheck`、Web / Electron 构建通过。
- 原生 Electron E2E：14 项通过。最后微调后，模型滑杆相关用例单独复跑通过。
- 交互覆盖：拖动中仅预览、松开保存、键盘 Home/End/方向键、模型切换后动态更新档位、无服务档位时隐藏快速开关、Ultra 用量提示、快速模式保存与恢复默认、重新打开后的设置保留、点击外部的焦点保留、Escape 返回触发按钮。
- 浏览器控制台 error / warn 记录为空。
- `pnpm package`：arm64 桌面包生成成功（当前本地构建未签名）。没有发起付费模型请求。

**Follow-up polish**

- P3：图片稿字号与系统字体栅格化的轻微差异；以现有 Rux 字号规范为准。

final result: passed
