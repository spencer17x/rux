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
