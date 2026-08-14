# P1 Desktop Release Candidate 验收

日期：2026-08-14

环境：未签名的 `app/release/mac-arm64/Rux.app`，独立 `--user-data-dir`、临时 Workspace、Fake Codex App Server 与 Fake Claude CLI。验收没有读取真实用户完整会话、修改真实认证状态或调用真实 Provider。

## 同一隔离环境中的发布旅程

1. 从干净 Workspace 启动，确认应用和 `Agent 与 Provider` 打开时均不自动检测；用户点击后才读取 Fake CLI 的非敏感状态。
2. 打开 `导入 Agent 会话`，确认打开本身不扫描；点击查找后分别显示当前 Workspace、待归属和需要项目授权的元数据。
3. 只在选择当前 Workspace Thread 后读取两条规范化消息，并确认本地复制、敏感内容和并发写入提示。
4. 选择 `导入并继续`，事务创建关联的本地 Task、Projection、不可变 Revision 与 Native Session Link。
5. 手动刷新返回 `unchanged`，版本页保留当前 Revision 和刷新审计；没有后台刷新。
6. 从导入 Task 生成确定性 Context Handoff，确认后创建固定 Claude Code Revision 的新 Task；来源 Task 与 Native Session 保持不变。
7. 重启同一打包应用和隔离 user-data，导入 Task、Handoff Task、Projection Revision 与来源关系均恢复；Terminal 没有自动恢复。
8. 打开本地数据管理，核对 Task、导入消息、Projection Revision、Handoff 和不受影响的 Native Session 数量。

## 验收中发现并修复的问题

首次本地数据复测发现，`解除关联` 的影响预览复用了删除动作的“删除后不承诺恢复”说明，错误暗示本地内容会被删除。Renderer 现按动作区分后果：解除关联明确说明 Task、消息和投影版本完整保留；删除导入内容和删除 Task 分别使用自己的不可恢复说明。修复后重新构建、打包并在同一隔离 Store 上复测通过。

## 证据

- `01-discovery-attribution.png`：显式发现后的当前 Workspace、待归属、需要项目授权分组；已导入 Thread 显示关联状态。
- `02-import-refresh-version.png`：导入 Task、不可变 Projection Revision 和 `unchanged` 刷新审计。
- `03-context-handoff-created.png`：确认后的新 Task 固定 Claude Code，展示来源 Task、Revision 与选中事实。
- `04-local-data-impact-fixed.png`：解除关联影响预览准确声明本地内容完整保留，原生会话不受影响。

导出原生保存面板、解除关联、删除导入内容和 Provider 不受影响的桌面证据继续由 `design-audit/p1-local-data-management/` 覆盖；事务回滚、差异候选、重建/恢复、凭据排除、Provider 无删除调用和重新导入由完整自动化测试覆盖。

## 结论

P1-E6 通过。P1 的发现、导入、刷新、版本、跨 Agent 分支、数据管理和重启恢复在打包应用中形成可复现的用户旅程；关键控件具备可见文字和 accessibility name。当前 macOS 包仍未签名，签名与公证继续作为分发门禁，不影响本地 P1 功能验收。
