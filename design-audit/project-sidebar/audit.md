# Project sidebar acceptance — 2026-08-10

## Outcome

Passed. Project headings now only expand or collapse their task history. A workspace is activated only when the user opens a task inside it, or explicitly starts a task from that project's empty state. The native picker remains a separate `打开项目…` action, and `账户与登录` remains a distinct footer action.

## Evidence

- Before: `/Users/17a/projects/rux/design-audit/project-sidebar/01-before.png`
- After: `/Users/17a/projects/rux/design-audit/project-sidebar/02-after.png`
- Codex-source comparison: `/Users/17a/projects/rux/design-audit/project-sidebar/03-codex-after-comparison.png`
- Viewport: `1362 × 768`, packaged macOS arm64 app, light theme.

## Verified path

1. Relaunched `/Users/17a/projects/rux/app/release/mac-arm64/RUX.app` from the rebuilt package.
2. Expanded inactive project `rux`; the active project and main task remained `app`.
3. Used the empty-project action; RUX activated `rux` and opened the new-task dialog.
4. Closed the dialog and selected a concrete task under `app`; RUX activated `app` and opened the requested task.
5. Collapsed `rux`, fully quit, and relaunched; expansion state and selected task were restored.

## Checks

- `npm test`: passed, 8/8 tests.
- `npm run build`: passed for Web/Sites and Desktop.
- `npm run package`: passed; the bundle is unsigned because no Developer ID certificate is configured.
- No actionable P0, P1, or P2 UI findings remain.

final result: passed
