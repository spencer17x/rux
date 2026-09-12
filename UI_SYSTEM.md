# Rux UI 统一方案

当前组件层位于 `src/ui`，复用已确定的浅色「单行落款」设计。对话运行、Agent 能力、IPC 和持久化继续由原有业务层负责。

## 分层与入口

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| 设计变量 | `src/ui/tokens.css` | 色彩、字号、间距、控件高度、圆角、层级和动效 |
| 图标 | `src/ui/icons.tsx` | Phosphor 白名单、语义映射、尺寸、线条变体与辅助技术语义 |
| 基础组件 | `src/ui/index.ts` | Button、IconButton、Input、Textarea、Select、Switch、Checkbox、SegmentedControl、Tabs、Menu、Popover、Modal |
| 业务组合 | `src/composer`、`src/navigation`、`src/assistant` 等 | 模型选择、权限、项目和消息展示；通过组件层组合交互 |
| 组件展示 | `?preview=components`（开发模式） | 实际组件的状态、键盘交互、图标和当前主题变量 |

交互底座使用直接依赖 `radix-ui@1.6.7`，与已有依赖树保持同一版本。图标库固定为 `@phosphor-icons/react@2.1.10`。不引入另一套视觉主题或 Tailwind。

## 使用规范

```tsx
import { Button, IconButton, Input, Menu, MenuItem, Modal, Select } from "../ui";

<Button variant="primary" size="md" loading={saving}>保存</Button>
<IconButton label="搜索项目" icon="search" />
<Input aria-label="项目名称" value={name} onChange={event => setName(event.target.value)} />

<Menu label="项目操作" trigger={<IconButton label="项目操作" icon="more" />}>
  <MenuItem onSelect={rename}>重命名</MenuItem>
  <MenuItem danger onSelect={remove}>移除项目</MenuItem>
</Menu>
```

- Button 变体：`primary`、`secondary`、`ghost`、`danger`；`plain` 用于导航行、组合选择器等结构性组件。
- 控件尺寸：`sm` 28px、`md` 32px、`lg` 40px。业务布局可以设置宽度，基础控件的高度与状态由组件层控制。
- IconButton 必须有 `label`；默认带统一 Tooltip。圆形发送/停止按钮使用 `shape="round"`，不自行改圆角。
- 图标尺寸：`xs` 12px、`sm` 16px、`md` 20px、`lg` 24px、`xl` 32px。默认线性 `outline`；选中或状态图标可用 `solid`，强调操作可用 `strong`。
- `AppIcon name="settings"` 等语义名称用于业务；已有的 `GearSix`、`Copy` 等导出也经过同一个 AppIcon 实现。业务不得直接导入 Phosphor 或传入任意数值尺寸。
- 品牌标记和两种权限盾牌是有意保留的图片例外，权限图案也通过统一尺寸解析。
- 分档胶囊滑杆使用 `SteppedSlider`，通过受控 `value`（档位索引）和 `labels` 定义可用档位。原生 range 保留拖动、键盘与焦点行为；刻度和标签与滑块中心对齐。普通连续滑杆仍使用 `Slider`。
- Select 使用 `value/onValueChange/options`，空值选项由组件统一编码。Switch 和 Checkbox 使用 `checked/onCheckedChange`。
- 单选 SegmentedControl 的条目使用 Radix 提供的 `radio` 语义，不再按普通按钮查询。
- 菜单操作使用 `onSelect`。Menu、Popover 管理边界定位、Escape 与外部点击；Modal 管理焦点和背景交互。不要在业务组件里再安装 pointerdown/focusin 监听器。
- 复合模型选择器的嵌入列表使用 ChoiceList/ChoiceItem；其页面切换仍属于业务逻辑，键盘选择处理集中在组件层。
- `AnchoredPopover` 用于输入工具栏中互斥的业务浮层。组件层统一处理浮层之间切换、弹窗接管焦点与返回触发按钮。
- 浮层宽度由 `AnchoredPopover` 统一控制：`xs` 160px 用于模式等短选项，`sm` 254px、`md` 320px、`lg` 358px 用于较丰富的内容。内部列表铺满容器，避免内外两套宽度产生空白。
- 原生文件选择器、系统确认窗口以及 assistant-ui 的对话输入运行机制保留；它们不伪装成普通组件。

## 已迁移的界面

- 顶栏和侧栏的操作菜单、项目/会话右键菜单、账户浮层。
- Agent、模式、模型和权限浮层的定位及关闭行为，Token 明细浮层。
- 重命名、添加项目、完整访问确认对话框。
- 设置页的文本输入、模型/协议选择、开关和单选分组。
- Git 分支菜单、审查页分支选择和页签、工作区工具菜单。
- 活跃业务 TSX 的原生按钮和表单元素；发送、停止和复制通过现有运行时组合 Rux 控件。

旧 `src/components/IconButton.tsx`、`FloatingPopover.tsx` 和 `menuKeyboard.ts` 只保留兼容导出，没有第二套实现。

## 样式治理与检查

主题值已移到 tokens.css。旧样式中已清理无效浮层规则及被后续覆盖的重复声明，结果记录在 `artifacts/ui-system/css-audit.json`。`styles.css` 与 `workbench-theme.css` 继续负责业务布局；新增的基础组件状态样式统一写在 `src/ui/ui.css`。

运行 `pnpm check:ui` 检查组件边界。该检查也包含在 `pnpm test` 中，阻止：

- 业务直接导入 Phosphor / Radix。
- 业务 TSX 新增原生 button/input/select/textarea 实现。
- 业务复制浮层外部点击或焦点监听。
- 使用旧 data-tooltip 实现或任意图标尺寸/weight。

历史独立演示 `src/prototypes` 和测试夹具不属于生产组件边界。UI 组件自身可以使用原生控件作为实现基础。

开发预览：`pnpm dev:web`，打开 `http://127.0.0.1:5173/?preview=components`。展示页不打入生产入口，也不连接真实 Agent。

参考：[Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction)、[Phosphor React](https://github.com/phosphor-icons/react)。
