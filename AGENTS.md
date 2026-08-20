# Rux Repository Instructions

## Product Goal

Rux v1 is a functionally equivalent implementation of the Codex workspace in the current ChatGPT desktop client, with `Rux` as the product name. It has no independent first-release product roadmap.

The single product contract is `docs/product-requirements.md`. Current target-client evidence defines what exists, how it behaves, and what must remain absent. User-provided current-client observations outrank generic documentation and repository history. OpenAI official documentation is used to verify semantics and current capability candidates, not to invent UI that the reference client does not expose.

Rux-specific multi-Agent orchestration, Claude Code, Rux Native, custom Providers, model switching/routing, Agent builders, Project Board, Improvement Center, controlled evolution, cross-Agent handoff, custom cloud sync and other historical concepts are not v1 product features unless the current reference Codex client visibly provides an equivalent flow. Dormant compatibility code and historical data may remain until a separately reviewed removal migration, but normal v1 UI and creation paths must not expose or create those objects.

## Instruction Scope

This file applies to the whole repository. `app/AGENTS.md` adds desktop renderer and visual-parity requirements for work under `app/`.

## Repository Map

- `app/`: Electron + React desktop application and browser fallback.
- `app/src/electron/`: Electron Main, Utility Process Runtime, Codex adapter, authentication and terminal integration.
- `app/src/shared/protocol.ts`: shared Runtime request, response, event and validation contract.
- `app/src/App.jsx` and `app/src/styles.css`: primary desktop renderer and visual system.
- `app/tests/`: desktop, Runtime, authentication, persistence, Git, release-boundary and Sites tests.
- `docs/product-requirements.md`: the only v1 product requirements and parity contract.
- `docs/desktop-architecture.md`: current desktop process boundaries and implementation status.
- `design-audit/`: visual evidence and audit notes; keep accepted screenshots paired with findings.

## Development Commands

Run commands from `app/` unless stated otherwise.

```bash
npm install
npm run dev
npm run dev:web
npm test
npm run build
npm run build:desktop
npm run package
```

On macOS arm64, the packaged app is `app/release/mac-arm64/Rux.app`. Packaging is not a substitute for launching and checking the resulting app.

## Parity Discipline

- Treat the current ChatGPT desktop Codex surface as the source of truth for navigation, controls, default state, terminology, density, layout, loading, errors and recovery.
- Record the reference client version, platform, account/region gates, viewport and click path for release evidence.
- Do not infer desktop UI from CLI commands, App Server methods, feature flags or dormant Rux code.
- Absence is part of parity. If the reference surface does not expose a control, Rux v1 must not expose it.
- The current confirmed reference exposes a Composer model/reasoning selector such as `5.6 Sol 中`. Match that control and its state; do not infer additional model-management UI beyond the captured reference.
- Use `Rux` for product branding while preserving exact technical names in commands, paths, logs, diffs, Provider errors and protocol evidence.
- Do not claim complete parity without same-version, same-state visual and interaction evidence.

## Architecture Guardrails

- Keep Renderer sandboxed: no Node integration and no direct filesystem, process, PTY or credential access.
- Expose the smallest possible typed API through Preload.
- Keep privileged Codex, CLI, PTY, Git and filesystem work in the Utility Process Runtime.
- Main owns native window lifecycle, external-link policy, workspace authorization, native dialogs, persistence and IPC routing; it must not become the agent runtime.
- Validate request envelopes in Main and method parameters in Runtime with shared schemas.
- When adding a Runtime method, update protocol, Runtime handler, renderer client/fallback, tests and architecture documentation together.
- Keep Workspace paths explicitly authorized. Switching Workspace must dispose the previous Runtime, PTYs and active Runs.
- Preserve Web fallback and Sites packaging unless the task explicitly removes that delivery path.

## Authentication And Credential Safety

- Delegate ChatGPT/Codex authentication to the official Codex boundary. Do not implement copied OAuth clients.
- Never read CLI credential files, scrape Keychain, copy tokens, log tokens or expose secrets to Renderer.
- Renderer-visible authentication data is limited to installation/connection state, normalized auth method, CLI version, executable path and sanitized detail.
- A direct user-triggered ChatGPT sync may additionally expose the bounded email, plan and rate-limit summary returned by official App Server account methods. Keep that snapshot in memory only; never persist it or refresh it in the background.
- Do not persist OAuth tokens or authorization output in Rux state.
- Real login, logout and credential replacement are consequential user actions. Unit-test with fake boundaries; do not mutate the developer's real login during routine verification.
- Dormant non-Codex credential code must remain unreachable from v1 UI and must not contact Providers in the background.

## Session, Workspace And Git Safety

- Persist and resume Rux-created Codex conversations through official native Session identifiers.
- A failed resume preserves the attempted Session and error evidence; never silently start a new Session and label it resumed.
- Assign each Task to an explicitly authorized Workspace and validate canonical real paths with component boundaries.
- Changes and Run evidence must be repository-backed. Do not make display fixtures look like real workspace state.
- Repository mutations require direct user actions. Never auto-stage, force-push or invent an upstream.
- Preserve task history, drafts and UI preferences across launches, but do not automatically restore a Terminal session.

## Compatibility Code

The repository contains substantial pre-reset compatibility infrastructure. It is engineering debt, not a v1 requirement.

- Do not add new dependencies on dormant multi-Agent, Provider, Board, Improvement, handoff, custom sync or model-routing flows.
- Do not restore their navigation or settings merely because tests or stores still exist.
- Preserve historical user data until an explicit migration includes impact preview, export/retention semantics and verification.
- Security tests for dormant code may remain while the code remains reachable internally; they do not define product scope.

## Change Discipline

- Inspect nearby implementation and patterns before editing.
- Preserve unrelated user changes in a dirty worktree. Do not reset, discard, stage, commit or push unless explicitly requested.
- Keep changes scoped. Fix adjacent issues only when they block the requested path or directly violate parity.
- Record durable parity decisions in the nearest `AGENTS.md` and update `docs/product-requirements.md` when the product contract changes.
- Keep documentation truthful about what is implemented, dormant, mocked, gated or unverified.

## Verification And Acceptance

- Run `npm test` for Runtime, protocol, authentication, persistence or renderer behavior changes.
- Run `npm run build:desktop` for desktop changes and `npm run build` when Web/Sites compatibility is in scope.
- Run `npm run package` for a release-candidate handoff.
- For visible desktop changes, launch the actual packaged app and verify the complete click path at desktop size.
- Capture stable before/after screenshots at the same viewport and target-client state; reject loading or stale evidence.
- Verify important controls through visible copy and accessibility names. Screenshots alone do not prove complete accessibility compliance.
- Do not claim OAuth, Session recovery, approval or parity success merely because a button or test fixture exists.

## Current Implementation Truth

- The Electron app, sandboxed Renderer, Main, Utility Process Runtime, official Codex session path, local Task/Run persistence, Git Changes, Context and Terminal are real.
- The current renderer still contains parity gaps, including user-facing model controls and disabled/legacy surfaces.
- Dormant compatibility modules and tests still exist for historical Rux features; they are not v1 product commitments.
- macOS packages are currently unsigned and require Developer ID signing and notarization before distribution.
- The implementation must not be described as functionally identical to current ChatGPT Codex until the parity contract's evidence gates pass.
