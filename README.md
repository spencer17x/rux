# Rux

Rux is a local-first Electron desktop client for working with the installed Codex CLI. It manages projects and nested conversations, uses the active Codex account and model catalog, exposes Git review and branch information, and provides an integrated project terminal.

```bash
pnpm install
pnpm dev
```

Useful commands:

- `pnpm test` checks types and builds the Web and desktop clients.
- `pnpm package` creates an unpacked desktop application for the current platform.
- `pnpm dist` creates distributable desktop artifacts.

The renderer is sandboxed. Codex, filesystem dialogs, Git, terminal, account, model, and system operations are exposed through explicit Electron IPC boundaries.
