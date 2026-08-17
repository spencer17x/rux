# Large-task Context Handoff desktop acceptance

Date: 2026-08-17

- Full automated suite, Desktop build, Runtime Host build, TUI build, and isolated unsigned macOS packaging passed.
- Launched `app/release-handoff/mac-arm64/Rux.app` with an isolated bundle id, user-data directory, and environment-authorized Workspace.
- Seeded only the isolated Task Store with 30 non-sensitive QA messages; no Provider or real Agent was contacted.
- Opened `复制为新任务` and verified the default selection is the latest 20 of 30 messages.
- Searched for `alpha`, reducing the visible set to 10, then used `全选当前结果`; the union became 24 selected messages without dropping hidden selections.
- Generated the deterministic preview and verified source/target Revision, target Engine/Connection, model/permission, fact fingerprint, latest Run, and immutable fact counts are visible.
- Did not generate an Agent summary and did not confirm/create the target Task.
- Closed only the isolated QA app.

Evidence: `handoff-filter-and-diagnostics.png`.
