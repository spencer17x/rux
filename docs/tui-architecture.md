# Rux TUI architecture, installation, and release

更新时间：2026-08-19 · Runtime protocol v18

> Compatibility status: the Rust TUI is not part of the Rux v1 ChatGPT Codex desktop parity surface. It may remain buildable while historical Runtime contracts are removed or migrated, but its commands and feature set do not define v1 product requirements.

## Product shape

The TUI follows a Grok Build-style keyboard rhythm while keeping Rux semantics: a single transcript, bottom composer, compact status line, contextual completion, persisted Task picker, blocking scoped permission decision, and on-demand evidence. It is a client of the same language-neutral JSONL Runtime Host as Desktop, not a second agent implementation.

The process boundary is:

```text
rux-tui (Rust, unprivileged UI)
  ⇅ one validated JSON object per line
rux-runtime.mjs (Node Runtime Host)
  ⇅ official CLI / Git / bounded filesystem services
Workspace and Provider-native Session
```

The TUI rejects a Runtime whose exact protocol version differs. It never parses CLI credentials or Provider transcripts directly. Demo mode is visibly non-mutating, and Replay mode never sends agent requests.

## Install and run

For source development:

```bash
cd app
npm ci
npm run build:desktop
npm run build:tui
../tui/target/release/rux-tui --workspace /path/to/repository
```

The desktop installer contains `rux-tui` under its Resources `bin` directory and the matching Host under `runtime-host`. The packaged TUI discovers those siblings and uses the packaged Electron executable as its Node runner, so users do not need a separate Node installation for that path. `rux-tui --version` prints both binary and protocol versions.

Run `rux-tui --help` for explicit Host, Node, Workspace, state-root, Agent, model, permission, Demo and Replay options. A local install must keep the TUI and Host from the same release together; copying only the TUI binary is unsupported.

## Keyboard contract

- `Enter` submits; `Shift+Enter` inserts a newline.
- `Tab` changes focus or accepts an open completion.
- `Ctrl+C` clears a draft first, then cancels an active Run.
- `Esc Esc` opens a non-mutating rewind preview and never silently cancels.
- `Ctrl+T` opens persisted Tasks; `Ctrl+E` opens Run evidence; `Ctrl+Q` exits.
- `/help`, `/status`, `/agent`, `/profile`, `/providers`, `/models`, `/sessions`, `/handoff`, `/data`, `/changes`, `/context`, `/branches`, `/new`, `/tasks`, and `/evidence` remain discoverable in-product.
- Restore is two-step and snapshot-guarded; review acceptance never stages, commits or pushes.

## Packaging and release

`npm run build:tui` copies the platform binary to `app/out/bin` with the correct Windows suffix and executable mode. electron-builder then includes that directory in DMG/ZIP, NSIS, AppImage and DEB outputs. `.github/workflows/release.yml` builds TUI and Host together on each target OS after the unified test gate. Release manifests and checksums cover the final installers.

Acceptance requires Rust unit tests, real child-process JSONL transport, stable 80×24 TestBackend snapshots, a real PTY journey, Clippy with warnings denied, Host protocol compatibility, and packaged discovery of the matching Host. Platform installer acceptance remains separate from compilation.

## Compatibility boundary

The TUI supports real Runs, persisted history, immutable Agent Profile creation/update/deletion, official CLI Provider login/status/logout, model selection, Native Session continuation, explicit external Session discovery/preview/import/refresh/rebuild/revision restore, deterministic Context Handoff with an optional isolated source-Agent summary, confirmation-gated local-data cleanup/export, Workspace and Run-owned Changes review/restore, Context selection, branches/compare/staged-only commit/guarded push, permission lifecycle and evidence.

Rux Native credential creation, replacement, diagnostics and deletion remain Electron Main-owned because their secrets are encrypted with Electron `safeStorage`. The standalone Node Host and Rust UI receive no decryption capability and must not replace that boundary with credential-file parsing, shell keychain scraping or plaintext storage. Configure those Connections in Desktop; the TUI can use official CLI Providers without weakening credential safety. Terminal panes are a desktop presentation surface rather than a Runtime feature; the TUI itself is already the terminal client.
