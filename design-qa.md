# Codex desktop reference — Design QA

## Evidence and normalization

- Source visual truth: `/Users/17a/.codex/attachments/f1711cd4-ae4b-41f0-a76b-bdfa53b89d06/image-1.png`.
- Source dimensions: `2866 × 1624` physical pixels at `@2x`, equivalent to a `1433 × 812` logical viewport.
- Canonical full-size comparison retained from the prior layout pass: `design-audit/codex-reference-2026-08-11/21-comparison-reference-web-handoff-final.png`.
- Current explicit visual fixture: `design-audit/codex-reference-2026-08-11/22-web-showcase-user-owned-data.jpg`, captured in the in-app Browser at `1280 × 720` from `/?showcase=codex`, with the completed task, environment card, and account menu open.
- Deterministic fixture recheck: `design-audit/codex-reference-2026-08-11/26-web-showcase-deterministic.jpg`, `1280 × 720`; it opens the reference task, expanded active project, and Environment panel without consulting or writing ordinary UI preferences.
- Current normalized comparison: `design-audit/codex-reference-2026-08-11/25-comparison-reference-showcase-user-owned-data.jpg`, `2560 × 720`. The source was cropped by 6 physical pixels at the top and bottom, then scaled to `1280 × 720`; the implementation was captured at native `1280 × 720` density.
- Normal Web startup: `design-audit/codex-reference-2026-08-11/23-web-clean-empty-state.jpg`, `1280 × 720`.
- Normal packaged startup: `design-audit/codex-reference-2026-08-11/24-packaged-clean-empty-state.jpg`, `1356 × 768`, launched with a fresh temporary Electron user-data directory and no `RUX_WORKSPACE_ROOT`.
- Final packaged recheck: `design-audit/codex-reference-2026-08-11/27-packaged-clean-final.png`, `1356 × 768`, from the rebuilt bundle with versioned Workspace authorization provenance.
- Final interactive showcase: `design-audit/codex-reference-2026-08-11/30-web-showcase-final-account.jpg`, `1280 × 720`, after the product, task, location, Environment Git, and source controls were connected.
- Final same-state visual comparison: `design-audit/codex-reference-2026-08-11/31-comparison-reference-showcase-final-account.jpg`, `2560 × 720`; the reference and implementation both show the completed task, Environment card, and account popover.
- Final packaged clean-start evidence: `design-audit/codex-reference-2026-08-11/32-packaged-clean-final-controls.jpg`, captured from the rebuilt `RUX.app` with a new temporary user-data directory and no project/account interaction.
- Final normal Web startup: `design-audit/codex-reference-2026-08-11/33-web-clean-final-controls.jpg`, `1280 × 720`.
- Current states: macOS light theme; explicit showcase for visual comparison; normal Web and packaged builds in the unimported, signed-out/unchecked empty state.

The screenshot's layout and interaction language remains the visual source of truth. Its imported projects, completed task data, Git changes, sources, and named account are not product defaults: the user's explicit instruction makes those user-owned data. They are therefore available only in the non-persisted `?showcase=codex` fixture and intentionally absent from normal startup.

## Full-view comparison evidence

The current side-by-side comparison confirms that the explicit showcase preserves the accepted visual anatomy: 240 px-style pale sidebar, compact header, centered transcript/composer rail, completed response hierarchy, code surface, verification list, edited-files card, floating environment card, and account popover. The canonical `1433 × 812` comparison remains the dimension-accurate evidence for the `240 / 46 / 736 / 300` layout anchors; the new `1280 × 720` comparison confirms that the same design remains coherent at the in-app Browser's current responsive viewport.

The account popover is the only intentional content deviation from the source. It now says `账户与登录` and `登录或连接 CLI` instead of inventing a person's name, quota, or logout state. This is required by the user-owned-data boundary and is not an actionable visual defect.

Focused regions were not split into another artifact because the changed surfaces—the account menu, empty project list, footer identity, and primary empty-state CTA—are fully legible in the original-resolution current captures. They were inspected directly alongside the full-view comparison.

## Required fidelity surfaces

### Fonts and typography

Passed. The native macOS system stack, compact sidebar labels, `13–15 px` hierarchy, code typography, response copy, and muted metadata remain aligned with the reference. The new empty-state copy uses the same weights and line-height hierarchy rather than introducing onboarding-specific styling.

### Spacing and layout rhythm

Passed. The accepted 240 px sidebar, 46 px header, 736 px content rail, bottom composer, and floating environment-card geometry are unchanged in showcase mode. Normal empty startup uses the same shell and places a single restrained `打开项目` run card in the transcript rail without adding a separate onboarding page or card grid.

### Colors and visual tokens

Passed. White workspace, `#fafafa` sidebar, low-contrast borders, neutral text, dark primary CTA, semantic diff colors, restrained radii, and limited elevation match the source system in both showcase and empty states.

### Image and asset fidelity

Passed. The source contains no photography or custom raster artwork. Existing Lucide vector icons remain consistent with the reference's line-icon language; no emoji, rasterized UI, handcrafted SVG, or placeholder illustration was added.

### Copy and content

Passed with an intentional product constraint. `rux` is the application brand. Real Codex CLI/provider/model names remain truthful. Normal startup contains no preloaded project, task, diff, source, account identity, quota, or login state. The visual fixture retains the screenshot-like completed content only behind `?showcase=codex` and does not persist it as user data.

## Interaction acceptance

- Normal Web startup exposes only `打开项目…`, `未打开项目`, and `账户与登录`; no project or task rows are present.
- `变更`, `环境`, terminal, and panel controls are disabled until a project exists; `Agents` remains a separate truthful Agent-definition entry.
- Clicking the Web `打开项目` control does not read a local directory; it returns a visible message directing the user to the desktop build.
- Normal startup does not call `auth.status`; opening the account surface is the first action that may request read-only CLI status, and OAuth remains behind a separate direct button action.
- The account popover contains no fabricated initials, person name, quota, or logout action.
- `?showcase=codex` still renders `+49/−3`, the two edited files, sources, completed response, environment card, and account-menu interaction for visual regression only.
- Legacy development state now records an authorization source. An unversioned active path that exactly matches the former automatic source-root default returns to the placeholder instead of starting that project's Runtime; the path and task store remain recoverable after a user click.
- In-app Browser console logs contain only Vite connection and React development messages; there are no warnings or errors from the application.
- The packaged app's accessibility tree shows `未打开项目`, `点击选择本机目录`, `账户与登录`, and disabled project-dependent controls.
- The fresh packaged `workspace-state.json` is version 2 with `authorizationSource: "placeholder"` and contains only a `placeholder: true` `welcome-workspace`; no real project path was imported.
- Desktop QA did not click the project picker or account surface and did not trigger login.
- The product switcher, task action menu, and VS Code/Finder location menu support pointer input, Escape, focus return, and explicit disabled states. The location menu's stacking order was verified over the floating Environment card.
- Environment Git listing begins only after disclosure. Existing-local branch switch, staged-only commit, confirmed upstream-only push, and merge-base comparison are real Runtime calls with visible loading/error/success states. Push tests prove repository `mirror` and `followTags` configuration cannot expand the confirmed ref update.
- Custom sources accept only workspace-relative files. Runtime validation rejects traversal, symlink escape, protected credential paths, and apparent secret contents before the task's Context selection is updated.

## Comparison history

### Passes 1–3

- Rebuilt and measured the Codex desktop anatomy, connected the interaction callbacks, and corrected the accepted `240 / 46 / 736 / 300` layout anchors.
- Verified the completed transcript, changed-files card, environment card, account menu, composer, real desktop Git/TaskStore boundaries, and packaged shell.

### Pass 4 — user-owned data boundary

- Removed normal Web showcase projects, tasks, changes, sources, and account identity.
- Changed clean development and packaged startup to the `welcome-workspace` placeholder unless a user-selected persisted workspace or explicit test override exists.
- Deferred CLI auth-status detection until the user opens `账户与登录`; no OAuth path runs on startup.
- Preserved the visual reference data only under explicit `?showcase=codex`.
- Re-captured the current showcase comparison, clean Web state, and clean packaged state after the changes.

### Pass 5 — deterministic fixture and legacy migration

- Made `?showcase=codex` independent of shared `localStorage`, fixed its selected task, expanded project, Environment panel, empty draft, and prevented preference writes.
- Added versioned Workspace authorization provenance. The old development source-root default and a removed environment override can no longer silently become active on a later normal launch.
- Verified the normal Web project CTA gives a visible desktop-only explanation and re-captured the deterministic showcase.

### Pass 6 — interaction closure and guarded Git operations

- Connected the product switcher, task rename/pin/archive menu, and explicit VS Code/Finder location menu with outside-click, Escape, focus-return, and accessibility semantics.
- Replaced misleading sidebar and Environment destinations with truthful `变更`, `环境`, and `Agents` actions; unsupported picture-in-picture remains visibly disabled as `未连接`.
- Added Runtime-backed local-branch listing/switching, staged-only commit, two-step confirmed upstream push, and branch comparison without auto-stage, upstream creation, force push, or hidden credential prompts.
- Added task-persisted, Runtime-validated relative-file sources and removal from the next Run Context.
- Re-captured a same-state reference/implementation comparison and then verified the final packaged app from a fresh temporary user-data directory without opening the project picker or account surface.

## Findings

No actionable P0, P1, or P2 visual or interaction findings remain. The generic account content and empty normal startup are intentional, user-requested data-boundary differences rather than fidelity regressions.

## Verification

- `npm test`: passed, including TypeScript, release boundary, auth, persistence, agents, adapters, permissions, Context, Runtime lifecycle/host, Git, Sites, and TUI suites.
- `npm run build`: passed for Web/Sites, desktop, Runtime host, and release TUI.
- `npm run package`: passed and rebuilt `/Users/17a/projects/rux/app/release/mac-arm64/RUX.app`.
- Non-blocking note: Vite reports a large renderer chunk, and the macOS bundle remains unsigned.

final result: passed
