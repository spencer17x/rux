# 模型选择器 · 胶囊滑杆

用户确认：第 3 版布局 + 指定的胶囊轨道 / 内嵌刻度 / 白色圆滑块。

- `selected-design.png`：确认稿。
- `slider-reference.png`：用户指定滑杆参考。
- `workbench-desktop-final.jpg`：1280 × 720 桌面状态。
- `workbench-narrow.jpg`：900 × 650 窄窗口。
- `comparison-final.jpg` / `comparison.html`：源图与实际实现，按相同浮层宽度裁切并排核对。
- `comparison-initial.jpg` / `workbench-desktop.jpg`：首轮对照，底部间距随后收紧 8 px。

实现位于 `src/composer/ComposerControls.tsx`、`src/ui/Fields.tsx` 的 `SteppedSlider`，使用现有 Rux UI 和 Phosphor 图标入口。完整验收记录见根目录 `design-qa.md` 的 2026-09-12 模型选择器章节。
