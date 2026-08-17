# Rux TUI

This crate is RUX's runnable full-screen terminal client. Its interaction rhythm is informed by Grok Build—scrollback plus a bottom composer, contextual shortcuts, `Tab` focus switching, `Ctrl+C` cancellation, double-`Esc`, slash completion, and `@` file search—but the implementation and JSONL protocol boundary are RUX-specific. The 80×24 layout includes keyboard-first persisted Task history, blocking Run-scoped Permission decisions, and expandable Run evidence.

By default it discovers the built or packaged RUX Runtime Host and connects to real Claude Code/Codex, Git Changes, Context, custom Agent profiles, and the shared SQLite Task Store. If no host exists, it falls back to a visibly labelled, non-mutating Demo. Replay mode remains read-only.

## Run

```bash
cd tui
cargo run -- --workspace /path/to/repository --agent codex --permission plan
```

Useful explicit modes:

```bash
cargo run -- --runtime-host ../app/out/runtime-host/rux-runtime.mjs --node node
cargo run -- --demo
cargo run -- --replay ./examples/demo-run.jsonl
```

Packaged binaries are installed beside the desktop Runtime Host:

```text
macOS:   Rux.app/Contents/Resources/bin/rux-tui
Windows: resources/bin/rux-tui.exe
Linux:   resources/bin/rux-tui
```

It automatically uses the packaged Electron executable as its Node runner and the sibling `runtime-host/rux-runtime.mjs`; no separately installed Node is required for that path. Use `--state-root` to isolate QA state. Without it, Desktop and TUI intentionally use the same RUX application state directory.

## Current interactions

- Type a prompt and press `Enter` to start a real run through the selected adapter.
- Multiple persisted Tasks open in a startup history picker. `Ctrl+T` (or `/tasks`) reopens it; `Up`/`Down` browse and `Enter` restores the selected transcript, Run settings, external session, and evidence. Active Runs and unresolved drafts guard against accidental switching.
- `Ctrl+E` (or `/evidence`) opens structured Verification and Run-owned Changes. `Enter` expands the selected record into command, cwd, recorded status, exit, log/redaction/truncation facts, tree IDs, snapshot ID, and per-file additions/deletions. A missing result stays `UNKNOWN`; Run completion is never rendered as a pass.
- An `acceptEdits` Run blocks on the Runtime's `permission.requested` event. The modal shows action, exact Workspace scope, this-Run duration, and impact. `A`/Approve and `D`/Deny use `permission.decide`; `S` or `Ctrl+C` uses `run.cancel`, which records a `cancelled` decision. Pending requests survive restart.
- `Tab` switches between composer and scrollback. When a completion menu is open, it accepts the selected completion instead.
- `Up`/`Down` and `PageUp`/`PageDown` scroll when scrollback is focused.
- `Ctrl+C` clears a non-empty draft first; with an empty draft it cancels a running turn.
- `Esc` never cancels a run. While idle, `Esc Esc` within 800ms clears a draft or opens a clearly labelled, non-mutating rewind preview.
- `/agent`, `/model`, `/permission`, and `/profile` inspect or change the next Run configuration; `/profile-create`, `/profile-update`, and the two-stage profile deletion flow manage immutable Agent Revisions; `/status` shows the effective selection.
- `/providers`, `/login`, the two-stage `/logout`, and `/models` use official CLI status/login/model interfaces without reading credentials.
- `/sessions`, `/session-preview`, `/session-import`, `/session-refresh`, `/session-revisions`, and confirmation-gated rebuild/restore manage Workspace-scoped external Sessions and local Projection versions.
- `/handoff` previews deterministic facts; `/handoff-summary` optionally invokes the pinned source Agent with tools and Native Session persistence disabled; the summary can be edited or removed before exact confirmation.
- `/data`, `/data-preview`, `/data-export`, and their exact confirmation commands expose impact-first local lifecycle and credential-excluding export.
- `/changes`, `/diff <path>`, `/context [paths…]`, and `/accept` use the real shared Runtime services. `/run-diff`, `/run-accept`, and the two-stage `/run-restore` flow operate on immutable Run-owned baseline/patch evidence. Accept is review-only and never stages, commits, or pushes.
- `/branches`, `/switch`, `/compare`, `/commit`, and two-stage `/push` use real Git operations; commit touches only already-staged changes and push never creates an upstream or force-pushes.
- `/restore <path>` only creates a preview. Destructive restore requires `/restore-confirm <same path>` and the same Git snapshot ID; stale previews are rejected.
- `/new`, `/tasks`, `/evidence`, `/clear`, `/rewind`, `/help`, and `/quit` manage the local task view. `/clear` does not erase persisted history.
- `@` searches workspace paths. Prefix the query with `!` to include hidden paths.
- `Ctrl+Q` exits.

The Runtime session ID returned by Claude/Codex is reused for the next turn until `/new` or an Agent change. Task messages, Runs, normalized events, activity, plan, usage, Permission requests/decisions, Verification, Run-owned Changes, review acceptances, adapter/model/permission/profile, and external session ID are persisted in the same store used by Desktop.

## Verification

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

The tests use `ratatui::backend::TestBackend` for stable 80×24 layout assertions and exercise input semantics, reducer effects, strict JSONL serialization, real child-process transport, shared Task switching, blocking Permission decisions/recovery, evidence truth, Git snapshot guards, command completion, file search, cancellation, and double-escape state. A macOS PTY acceptance test launches the actual binary, changes the terminal to 80×24, switches Tasks, expands `UNKNOWN` evidence, and exits with `Ctrl+Q`. The unified repository gate is `cd app && npm test`.

Current release limits are explicit: Rux Native secret Connection management stays Electron Main-owned, and SSH/reconnect/load testing is not complete. The Host advertises protocol v16; incompatible versions visibly block Runs, and Custom-Agent Runs pin an immutable Agent Revision plus a non-secret Provider Connection reference. Session Connector, isolated Handoff, local-data lifecycle, branch operations, and Run-owned review methods are exposed through confirmation-gated TUI commands. Task selection is session-local because the shared snapshot still has no separate active-Task field; restart deterministically selects the newest non-archived Task and shows history when more than one exists.

See [`../docs/tui-architecture.md`](../docs/tui-architecture.md) for the protocol and integration path.
