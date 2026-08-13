# P1-E1 Session Discovery Desktop Acceptance

Date: 2026-08-13  
Build: unsigned macOS arm64 package at `app/release/mac-arm64/Rux.app`  
Viewport: packaged Desktop window at the repository default desktop size  
Environment: isolated temporary Workspace and user-data directory; Fake Codex App Server; missing Claude Agent SDK capability fixture

## Accepted path

1. Launch the packaged application in an isolated authorized Workspace.
2. Confirm the labelled `导入 Agent 会话` entry is visible and has an accessibility name.
3. Open the surface and confirm it remains in `尚未查找本机会话`; opening alone makes no discovery request.
4. Explicitly click `查找 Rux 会话` and confirm one stable metadata-only result appears under `当前项目`, with no content preview or import action.
5. Switch to Claude Code and explicitly search; when the supported SDK capability is absent, confirm the UI explains that Rux will not fall back to internal Transcript parsing.
6. Run the isolated attribution fixture and confirm current, missing-path, and outside-authorized-root sessions render in separate groups; only the outside item offers the native `打开项目…` authorization path.

## Evidence

- `01-open-no-scan.png`: stable initial surface before any provider call.
- `02-current-workspace-metadata.png`: current-Workspace metadata result after explicit search.
- `03-claude-capability-unavailable.png`: truthful supported-interface capability failure.
- `04-attribution-groups.png`: current Workspace, unassigned, and authorization-required metadata states.

## Result

Accepted for P1-E1. The packaged flow preserves explicit discovery, metadata-only disclosure, visible Workspace attribution, and a recoverable provider-capability error. P1-E2 content selection/import is intentionally absent.
