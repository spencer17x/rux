# Rux

Rux is a local-first Electron desktop workbench for Codex, Claude Code, and Pi. It manages projects and agent-bound conversations, streams native agent events through a shared UI, exposes Git review, and provides project workspace tools.

```bash
pnpm install
pnpm dev
```

Useful commands:

- `pnpm test` runs unit tests, checks Electron/shared TypeScript, and builds the Web and desktop clients.
- `pnpm package` creates an unpacked desktop application for the current platform.
- `pnpm dist` creates distributable desktop artifacts.

The renderer is sandboxed. Codex, filesystem dialogs, Git, terminal, account, model, and system operations are exposed through validated Electron IPC boundaries. Project, thread, and transcript state is stored in SQLite; the terminal uses a native PTY rendered with xterm.

Agent runtimes are pinned and integrity-verified before Rux installs them on first use. Codex uses the active Codex account, Claude Code uses its native account flow, and Pi uses an explicitly configured compatible Provider profile.
