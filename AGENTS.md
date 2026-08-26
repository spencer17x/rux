# Rux Repository Instructions

Rux is a local-first Electron workbench for project-scoped conversations with
multiple coding agents. The supported adapters are Codex, Claude Code, and Pi.
Preserve the shared conversation shell, explicit agent capability boundaries,
project and session persistence, Git review, and project terminal workflows.

## Repository shape

- The repository root contains the Electron main process, sandboxed preload,
  React renderer, and native agent adapters.
- The Renderer stays sandboxed and has no Node.js access.
- Privileged operations must use validated, narrowly scoped IPC contracts.
- Native agent sessions remain bound to their originating agent.
- Keep secrets in Electron safe storage and never expose them to the Renderer.
- Managed agent runtimes may be downloaded on first use only from pinned,
  integrity-verified packages, with visible progress and actionable errors.
- Do not present controls for capabilities that are not implemented end to end.

Run development and verification commands from the repository root:

```bash
pnpm install
pnpm dev
pnpm test
pnpm package
```

Preserve unrelated user changes. Do not stage, commit, or push unless explicitly
requested.
