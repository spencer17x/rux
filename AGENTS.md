# RUX Repository Instructions

## Product Goal

RUX is a desktop workbench for using, observing, and controlling coding agents. The product should turn opaque agent runs into an experience that is visible, controllable, reviewable, and recoverable. The desktop app is the first client; a Grok Build-style TUI should eventually consume the same Runtime protocol.

The near-term product is a coding-agent workbench, not a generic chat shell. Prioritize workspace-aware tasks, run visibility, permissions, changes, context, terminal access, and adapter interoperability.

## Instruction Scope

This file applies to the whole repository. More specific `AGENTS.md` files add directory-level requirements. In particular, `app/AGENTS.md` contains the detailed desktop UI and prototype rules and must be followed for work under `app/`.

## Repository Map

- `app/`: Electron + React desktop application and browser fallback.
- `app/src/electron/`: Electron Main, Utility Process Runtime, CLI adapters, authentication, and terminal integration.
- `app/src/shared/protocol.ts`: shared Runtime request, response, event, and validation contract.
- `app/src/App.jsx` and `app/src/styles.css`: primary desktop renderer and visual system.
- `app/tests/`: authentication-boundary and Sites compatibility tests.
- `docs/product-requirements.md`: product positioning and MVP scope.
- `docs/desktop-architecture.md`: current process boundaries, protocol, and implementation status.
- `design-audit/`: accepted UX evidence and audit notes. Keep screenshots paired with their written findings.

## Development Commands

Run commands from `app/` unless stated otherwise.

```bash
npm install
npm run dev          # Electron development app
npm run dev:web      # Browser fallback only
npm test             # Typecheck, auth tests, and Sites tests
npm run build        # Web/Sites and desktop builds
npm run build:desktop
npm run package      # Unsigned current-platform app bundle
```

On macOS arm64, the packaged app is `app/release/mac-arm64/Rux.app`. Packaging is not a substitute for launching and checking the resulting app.

## Architecture Guardrails

- Keep the Renderer sandboxed: no Node integration and no direct filesystem, process, PTY, or credential access.
- Expose the smallest possible API through the sandboxed Preload and typed IPC.
- Keep privileged agent, CLI, PTY, and filesystem work in the Utility Process Runtime.
- Main Process owns native window lifecycle, external-link policy, workspace authorization, and IPC routing; it should not become an agent runtime.
- Validate request envelopes in Main and method parameters in Runtime with the shared Zod schemas.
- When adding a Runtime method, update the shared protocol, Runtime handler, renderer client/fallback, tests, and architecture documentation together.
- Keep workspace paths explicitly authorized. Switching workspace must dispose the previous Runtime, PTY sessions, and active runs.
- Preserve the Web fallback and Sites packaging files unless the task explicitly removes that delivery path.

## Desktop Product And UI

- Stay visually close to the Codex desktop app: pale flat sidebar, one focused task transcript, restrained disclosure, prominent bottom composer, and on-demand Changes/Context/Run surfaces.
- Prefer clear task-oriented navigation over an IDE-style permanent multi-panel layout.
- Keep task history compact and use real lifecycle states. Do not make completed showcase content look permanently busy.
- Do not ship ambiguous icon-only entry points for important flows. Workspace switching and account authentication must remain separate, visibly labelled actions.
- The bottom-most sidebar account row must open `账户与登录`; the `当前项目` row owns the native workspace picker. Project headings only expand or collapse task history, while opening a task activates its workspace. Keep `打开项目…` as a separate labelled action.
- Preserve existing UI, draft, sidebar, and review preferences across launches, but do not automatically restore a terminal session.
- Treat user-provided screenshots or a selected mock as the source of truth for layout, density, typography, color, and hierarchy.

## Authentication And Credential Safety

- RUX delegates authentication to the official local CLIs. Use `claude auth login/status` for Claude Code and `codex login/status` for ChatGPT/Codex.
- Never implement a copied Claude.ai OAuth client, read CLI credential files, scrape Keychain items, copy tokens, log tokens, or expose tokens to the Renderer.
- Renderer-visible authentication data is limited to installation state, connection state, normalized auth method, CLI version, executable path, and non-sensitive detail text.
- Do not persist OAuth tokens or authorization output in RUX state. Browser authorization, credential storage, and refresh remain owned by the official CLI.
- Treat real OAuth authorization, logout, and credential replacement as consequential user actions. Unit-test the process boundary with fake CLIs; do not mutate the developer's real login state during routine verification.
- Claude subscription OAuth is only delegated to the user's local official Claude Code CLI. A hosted third-party service must use Anthropic Console API keys or a supported cloud-provider setup instead.

## Change Discipline

- Inspect the existing implementation and nearby patterns before editing.
- Preserve user-owned or unrelated changes in a dirty worktree. Do not reset, discard, stage, commit, or push unless explicitly requested.
- Keep changes scoped to the requested behavior. Fix adjacent defects only when they block the requested flow or create a direct correctness issue.
- Update durable product decisions in the nearest applicable `AGENTS.md`.
- Keep documentation truthful about what is real, mocked, or display-only.

## Verification And Acceptance

- Run `npm test` for every Runtime, protocol, authentication, or renderer behavior change.
- Run `npm run build:desktop` for desktop changes and `npm run build` when Sites/Web compatibility is in scope.
- Run `npm run package` when handing off an updated desktop bundle.
- For visible desktop changes, launch the actual packaged app and verify the complete click path at desktop size. A browser fallback screenshot alone is insufficient.
- For UX acceptance, capture stable before/after screenshots, reject loading-state evidence, and record the flow under `design-audit/` when the task calls for an audit.
- Verify important controls through both visible copy and accessibility names. Do not claim complete accessibility compliance from screenshots alone.
- Do not claim OAuth success merely because a button exists. Confirm read-only CLI status in the packaged app; only perform a real authorization flow when the user explicitly chooses it.

## Current Product Truth

- Claude Code runs use the real local CLI adapter and normalized stream-json events.
- Task, Message, and Run event history is persisted per authorized Workspace in a Main-owned SQLite store; orphaned running records are restored as stopped/interrupted.
- RUX Agent is still a mock event-protocol adapter.
- The current account surface presents explicit, user-triggered Rux login while delegating the action to the official `codex login` command. It does not automatically synchronize CLI login state; `auth.status` remains a compatibility/diagnostic Runtime method.
- Changes and Context still contain showcase data in parts of the renderer and must not be described as fully repository-backed until that wiring is completed.
- macOS packages are currently unsigned and require Developer ID signing and notarization before distribution.
