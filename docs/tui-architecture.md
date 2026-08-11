# RUX TUI architecture

Status: live Desktop companion. The Ratatui UI, reducer, real child-process JSONL transport, demo/replay clients, keyboard-selectable shared Task history, agent/model/profile selection, session resume, blocking Run-scoped Permission decisions, Context, Git review, expandable Verification/Run-owned evidence, and protocol-version rejection are connected. Provider-specific per-tool approvals, terminal panes, SSH/reconnect/load hardening, generated cross-language schema fixtures, and complete scalar-conflict UX remain incomplete.

## Product shape

The TUI is a second client for the same coding-agent workbench model as the desktop app. It is intentionally task-oriented rather than a generic chat shell:

- one focused task transcript;
- streamed agent/runtime activity in scrollback;
- a bottom composer with `/` command and `@` file discovery;
- visible lifecycle and connection truth in the status area;
- cancellation, review, and rewind affordances that do not overstate backend support.
- `Ctrl+T` Task history and `Ctrl+E` evidence inspectors that remain usable at 80×24.

The interaction reference was the local Grok Build pager documentation and its high-level `AppView → Action → dispatch → Effect → event loop` structure. RUX does not copy its implementation or internal protocol.

## Layers

```text
crossterm input / JSONL lines
              │
              ▼
           Action
              │
              ▼
        App::update()       pure state transition boundary
              │
              ▼
           Effect          SendRuntime | Quit
              │
              ▼
      Effect executor / persistence
              │
              ▼
     RuntimeClient trait   one JSON object per line in both directions
      │            │             │
      ▼            ▼             ▼
Process client  Demo client   Replay client
      │         deterministic  read-only file
      ▼
RUX Runtime Host (TypeScript/Node)
      │
      ├── Claude Code / Codex adapters
      ├── Git Changes / Context / custom Agents
      └── shared SQLite Task Store
```

- `App` owns visible state: screen, focus, composer, scrollback, overlays, run lifecycle, and contextual status.
- `Action` represents input or decoded runtime messages.
- `Effect` keeps Runtime writes and process exit outside the reducer.
- `RuntimeClient` accepts and emits JSONL strings only. Rust types are encoded/decoded on the TUI side of the boundary, while `ProcessRuntime` owns a child Runtime Host, validates one object per line, keeps a bounded stderr tail, and terminates the child on exit.
- `ui` is a pure Ratatui renderer and is exercised with `TestBackend`.
- `TaskPersistence` loads/saves the same validated Workspace snapshot used by Desktop. It selects the newest non-archived Task initially, exposes every persisted Task for keyboard switching, and restores messages, previous Runs, selected adapter/model/permission/profile, external session ID, pending Permission, Verification, and Run-owned Git facts before allowing a live submission.

## JSONL boundary

The initial envelope deliberately follows the desktop Runtime's current request/event shape.

Request:

```json
{"kind":"request","id":"tui-request-1","method":"run.start","params":{"runId":"tui-run-1","adapter":"codex","prompt":"Fix the tests","permissionMode":"plan"}}
```

Response:

```json
{"kind":"response","id":"tui-request-1","ok":true,"result":{"runId":"tui-run-1","adapter":"codex"}}
```

Event:

```json
{"kind":"event","event":{"type":"assistant.message","runId":"tui-run-1","text":"A streamed chunk"}}
```

Each line is independently valid JSON. Literal newlines between multiple records are rejected by single-message decoders. Unknown event types remain decodable and are surfaced as generic runtime events, allowing additive protocol evolution.

Implemented Runtime methods used by the TUI (protocol v2):

- execution: `agent.list`, `agent.profile.list`, `run.start`, `run.cancel`, `permission.decide`;
- review: `changes.list`, `changes.diff`, `changes.previewRestore`, `changes.restore`, `changes.accept`, `context.snapshot`;
- shared state: `task.state.load`, `task.state.save`;
- events: `runtime.ready`, `permission.requested`, `permission.decided`, `run.started`, `run.metadata`, `run.context-snapshot`, `run.git-baseline`, `run.git-patch`, `run.reasoning`, `run.plan`, `run.usage`, `run.log`, `verification.recorded`, `activity.started`, `activity.completed`, `assistant.message`, `run.completed`, `run.cancelled`, `run.failed`;
- response envelopes: success and structured error.

The TypeScript Runtime Host imports the same protocol/service implementation as Desktop and advertises `protocolVersion: 2` in `runtime.ready`. The TUI shows `NEGOTIATING` until this event, shows `CONNECTED · v2` only for the expected version, and visibly blocks every Run for missing/mismatched versions; an automated mismatch test enforces this. Rust boundary types are still maintained manually, so generated shared schema fixtures are required before the protocol can be called stable.

## Runtime discovery and packaging

Discovery order is explicit CLI path, repository build output, then packaged sibling resources. In a packaged macOS app, `Resources/bin/rux-tui` locates `Resources/runtime-host/rux-runtime.mjs` and uses `Contents/MacOS/Rux` with `ELECTRON_RUN_AS_NODE=1` (while retaining an `RUX` fallback for older bundles). The host is production-only and never exposes the mock adapter.

The repository-level `npm run package` builds the release Rust binary before electron-builder copies it into the app. Package verification checks that the bundled Mach-O ARM64 binary is byte-identical to the release build and can automatically establish `LIVE JSONL · CONNECTED` without a separate Node installation.

## Safety and product truth

- The demo badge always says `NOT CONNECTED` and its transcript says that no agent or filesystem operation occurred.
- Replay rejects outgoing Runtime requests instead of pretending they ran.
- Live mode shows the effective Runtime path, adapter, model, permission, profile, connection state, and Run lifecycle.
- `Esc` does not cancel active work; `Ctrl+C` does.
- A pending `permission.requested` event cannot be dismissed with `Esc` or hidden behind another inspector. The modal exposes action, exact scope path, this-Run applicability, impact, and timestamp before accepting a decision.
- Approve/Deny send the exact `runId`, `requestId`, and `approved|denied` value through `permission.decide`. Stop uses `run.cancel`, matching protocol v2's deliberate exclusion of `cancelled` from `permission.decide`; the Runtime emits and persists the resulting cancelled decision.
- A failed Permission response restores the same pending modal rather than pretending the Run launched. Restart hydration also reopens any persisted pending request.
- Verification rendering trusts the persisted `passed|failed|unknown` field. It never infers pass from Run completion; unknown evidence has no fabricated exit result.
- Double-`Esc` rewind opens a preview labelled `NOT CONNECTED`; it cannot alter transcript or files.
- `/clear` only clears the visible local transcript and says so.
- `@` indexes path names only; it does not read file contents.
- `/accept` records a review decision without staging, committing, or pushing.
- Restore is a two-step preview/confirm flow guarded by the exact Git snapshot ID and path. A stale or different selection cannot reuse the approval.
- The authorized Workspace is passed to every Runtime service; traversal and stale-snapshot paths are rejected by the shared Git service.

## Verified paths

- Real Codex prompt → streamed events → completed Run, followed by a second turn reusing the external session ID.
- TUI-created Task/Message/Run persisted to an isolated shared SQLite database, restored after TUI restart, then opened in packaged Desktop with the same transcript and Run.
- Real repository `/changes`, `/context`, and review-only `/accept`; the Git status hash remained unchanged after acceptance.
- Packaged TUI auto-discovery of the packaged Runtime Host and real Git Changes.
- Real PTY at 80×24: startup Task history → keyboard switch → `Ctrl+E` evidence → expanded `UNKNOWN` command facts → `Ctrl+Q` terminal restoration.
- `Ctrl+Q` and normal completion restore the terminal alternate screen/cursor.

## Remaining delivery work

1. Replace the current coarse Workspace-write Run gate with provider-specific per-tool approval callbacks when official non-interactive adapter protocols expose a stable boundary.
2. Extend the transaction-serialized Task/Message/Run/Event/review merge with deletion tombstones, scalar-conflict UX, revision telemetry, and true simultaneous-process stress tests.
3. Generate/version the cross-language protocol instead of maintaining Rust boundary types manually.
4. Add SSH-equivalent, resize, high-frequency/long-output, Runtime restart/reconnect, and resource-budget suites.
5. Add terminal ownership/handoff only after capability detection and lifecycle tests exist.
6. Enforce configured Skill/Tool capability sets at execution time and persist their auditable invocation results, not just their immutable Agent profile snapshot.
