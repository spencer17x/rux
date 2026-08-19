# Rux vs Codex Desktop self-audit

Date: 2026-08-18

## Scope

Combined UX, visual, and accessibility-risk audit of the packaged `app/release/mac-arm64/Rux.app` across blank task, historical task, Environment, account, Settings, and Changes. The comparison baseline is the repository-designated Codex Desktop `26.810.52044` reference plus the v1 product rules.

## Flow steps

1. Blank task — healthy visual shell, but duplicate empty tasks and redundant controls remain.
2. Historical/imported task — poor; compatibility concepts dominate the transcript.
3. Environment — mixed; anatomy is close, but it covers transcript content at the actual desktop width.
4. Account — mostly healthy, but visually miniature and detached from the full settings hierarchy.
5. Settings — mixed/poor; Codex controls are disabled despite a connected account and visible copy still says `Rux default`.
6. Changes — mixed/poor; the panel is dense, IDE-like, overlaps content, and exposes Rux-specific review semantics.

## Highest-impact findings

1. **P1 — Legacy compatibility leaks into the v1 experience.** Imported tasks show local projection status, refresh, versions, local-data management, imported-event summaries, Provider language, and old product-planning conversation content. This contradicts the simple Codex-only mental model.
2. **P1 — Overlays obscure the transcript.** Environment and Changes float over the right edge of user messages and the change summary at the actual 1356 × 768 desktop size. The reference uses the right overlay without hiding the central reading rail.
3. **P1 — Codex connection state is inconsistent.** Account shows connected ChatGPT OAuth, while Settings disables model, reasoning, model refresh, and still displays `Rux default`.
4. **P1 — Raw infrastructure errors are shown as assistant content.** `Error invoking remote method`, `RUNTIME_REQUEST_FAILED`, internal service naming, and exact timeout wiring are visible with no concise recovery action.
5. **P2 — Empty Task lifecycle is unlike Codex.** Multiple persisted `新对话` rows accumulate before a meaningful title exists, making the project rail look duplicated and unfinished.
6. **P2 — Transcript evidence is too prominent.** Repeated `Run #`, Engine labels, Token pills, imported-event disclosure cards, and a workspace-wide change card compete with the actual conversation.
7. **P2 — Changes is too IDE-like.** Three tabs, file list, full diff, two bottom actions, English/Chinese mixed copy, and persistent Workspace explanation create a dense permanent-inspector feel.
8. **P2 — Account typography is undersized.** The modal uses very small secondary text and concentrates status, version, authentication, settings, and logout into a narrow card.
9. **P2 — Model/Token semantics look untrustworthy.** The UI labels evidence as `本回合`, but the displayed token totals grow from 26k to 54k to 101k across tiny turns, which reads like cumulative usage presented as per-turn usage.

## Strengths

- Pale flat sidebar, compact project rail, 46 px-style top bar, centered Composer, and restrained neutral palette are recognizably Codex-like.
- Blank-task hierarchy is calm and focused.
- Environment and account are true overlays instead of permanent columns.
- Important icon controls expose accessibility names in the packaged accessibility tree.
- Composer keeps separate file, Codex identity, approval, model, voice, and send controls.

## Accessibility risks

- Disabled model controls have no nearby accessible reason even though the account surface reports connected.
- Task hover cards are visually helpful, but tooltip association with the task row was not confirmed for assistive technology.
- Very small account/status text may fail comfortable readability even if nominal contrast passes.
- Mixed Chinese/English action labels increase cognitive load and may produce inconsistent screen-reader pronunciation.
- Screenshots and the accessibility tree do not prove keyboard order, zoom/reflow, contrast ratios, or live-region behavior.

## Evidence

- `01-blank-task.png`
- `02-task-history.png`
- `03-environment.png`
- `04-account.png`
- `05-settings.png`
- `06-changes.png`

## Recommended order

1. Hide legacy import/session-management concepts behind a single compatibility disclosure and keep old tasks visually read-only.
2. Make Environment/Changes collision-aware at the real packaged window size.
3. Unify Codex connection state and replace `Rux default` with `Codex 默认`.
4. Sanitize runtime failures and add one clear retry/recovery action.
5. Stop persisting untouched blank Tasks and reduce transcript evidence to on-demand Run details.
6. Simplify Changes and normalize copy/localization.
