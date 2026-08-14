# P1-E5 本地数据管理桌面验收

日期：2026-08-13

环境：`app/release/mac-arm64/Rux.app`，macOS arm64，1433 × 812 桌面窗口。验收使用临时 Bundle ID 和独立 `--user-data-dir`；导入会话是仅存在于隔离 SQLite 的测试 fixture，没有调用 Provider，也没有改动日常 Rux 数据。

## 证据

- `01-impact-preview-and-export.jpeg`：从设置进入 Workspace 本地数据页；占用、Task 和 Revision 统计可见；清理必须先生成影响预览；导出风险提示可见。点击导出后出现原生保存面板，取消后显示“已取消导出”。
- `02-imported-task-impact-preview.jpeg`：从导入 Task 时间线的“管理本地数据”进入；Task 范围、1 条导入消息、1 个 Projection Revision 和 1 个不受影响的 Native Session 均正确展示。
- `03-unlinked-task-retained.jpeg`：修复包中确认解除关联后，Task 和导入消息仍保留；时间线明确显示“已解除关联，本地内容仍保留”，刷新原生会话按钮被禁用，版本与本地数据入口仍可用。

## 点击路径与结果

1. `账户与登录 → Rux 设置 → 本地数据`：通过。
2. Workspace 统计与 `生成影响预览`：通过。
3. Markdown 导出风险确认 → 原生保存面板 → 取消：通过，没有写入文件。
4. 导入 Task → `管理本地数据` → 解除关联预览 → 二次确认：首次发现 Main 已校验的 `confirmed` 被错误传入严格 Task Store 预览 schema；操作被拒绝且没有数据变化。修复参数拆分并重新打包后复测通过。
5. 解除关联后：本地消息和 Revision 保留、刷新禁用：通过。
6. `删除导入内容` → 影响预览 → 二次确认：在隔离 fixture 中通过。完成后 Task 仍存在，导入消息、绑定和 Projection Revision 归零，界面明确声明 Provider 原生会话未被修改。

桌面截图只能证明可见结构与当前可访问名称；协议、凭据排除、过期指纹、Run/Handoff 保留、Provider 无删除调用和重新导入由自动化测试覆盖。
