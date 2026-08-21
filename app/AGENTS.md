# Rux Desktop Parity Instructions

## Product Boundary

Rux v1 recreates the Codex workspace in the current ChatGPT desktop client with functional and interaction parity. `Rux` replaces the product brand; it does not create a separate v1 product model.

The current target-client surface is authoritative. Direct user observations and same-version screenshots outrank older Codex references, generic OpenAI documentation, CLI/App Server capability and existing Rux code.

Do not expose a feature merely because Runtime supports it. V1 Renderer must not show Rux-specific Agents, Claude Code, Rux Native, custom Providers, model switching/routing, Board, Improvement Center, handoff, custom sync or any historical navigation unless the current reference Codex client visibly exposes an equivalent flow.

## Confirmed Current Decisions

- The authoritative 2026-08-19 screenshots live under `design-audit/chatgpt-codex-current-2026-08-19/` at 2866 × 1624.
- The current ChatGPT Codex reference exposes a Composer model/reasoning selector such as `5.6 Sol 中`; preserve and align it.
- Direct 2026-08-20 evidence replaces the flat model list with the current nested Composer menu: primary rows are `模型`, `推理强度`, `速度`, and `高级`, with model/effort/speed choices in right-side submenus. Model effort and service-tier options come from official `model/list`; selected `serviceTier` is passed to `thread/start`/`thread/resume` and `turn/start`.
- Match the screenshot navigation (`新对话`, `拉取请求`, `站点`, `已安排`, `插件`), bottom account popover, full settings taxonomy, quick-tools menu, right Environment panel and bottom Terminal dock.
- Direct feedback captured on 2026-08-19 requires the model menu to load the real Codex catalog on demand and distinguish every model/effort option; a one-item menu is a failure state, not parity.
- Composer paste accepts PNG/JPEG/GIF/WebP clipboard images, previews removable thumbnails, persists them through a Main-owned bounded attachment path, and sends them as official App Server `localImage` inputs.
- The bottom Terminal and right Environment/Review surfaces are mutually exclusive. Terminal supports real add/select/close tab interactions; opening Review from quick tools opens Changes, not Environment.
- The account footer and popover must use truthful Codex connection copy. Do not present `账户与登录` as a user identity or hard-code usage percentages; at the 1433 × 812 reference viewport the compact 224 px menu is anchored 9 px from the left and 44 px from the bottom without clipping its profile or logout rows.
- Direct user feedback on 2026-08-20 removes the Pets surface from Rux v1: do not show `显示宠物` in the account menu or `宠物` in Settings.
- ChatGPT account state sync is explicit and user-triggered. The Runtime may expose the bounded `account/read` email/plan and rate-limit summary returned by the official App Server only for the current in-memory UI; never read credential files, expose tokens, persist the email, or refresh in the background.
- Imported Agent conversations are editable Rux-owned copies. Normal import has one `copy` path, never resumes or writes the source Native Session, and seeds the first Rux-managed Session with a bounded copy of imported user/assistant history. Legacy `view`, `continue`, `read-only`, `native-unavailable` and `unlinked` values may remain schema-readable only for historical data; they must not lock the Composer or appear as current creation choices.
- New chat actions open a focused blank Task directly; do not add a Rux setup modal.
- New Codex chats immediately use the last validated official model catalog snapshot and explicitly refresh it. Never render the engine-default placeholder as `Codex 中`; while the first catalog is loading, show a loading/selection state, then the real default model and reasoning label.
- A Codex Run may emit multiple assistant messages (progress commentary followed by the final answer). Preserve their order, but show model/Token evidence only on the last assistant message after that Run reaches a terminal state, and do not insert a redundant generic “running” explanation once real assistant text is visible.
- Product, Workspace selection and account/login remain distinct actions.
- Normal v1 startup and settings are Codex-only. Historical non-Codex data may remain readable only when doing so does not reintroduce a normal creation or configuration path.

## Evidence Before UI Decisions

For each visible parity change, capture or receive evidence for the exact target state:

- ChatGPT client build/version;
- macOS/Windows platform and account/region gates;
- viewport and window state;
- entry action and complete click path;
- stable screenshots for default, active, loading, empty, error and recovery states that matter.

If Computer Use cannot capture the target ChatGPT/Codex window, record the blocker and rely on user-provided same-version evidence. Do not substitute an older screenshot or generic documentation and call it exact parity.

## Renderer Composition

- Match the reference sidebar, top bar, focused transcript, bottom Composer and on-demand overlays exactly enough that hierarchy, density and interaction are recognizably the same.
- Avoid a permanent IDE-style multi-panel layout unless the current reference uses it.
- Keep Composer height in normal layout so final content remains visible above it.
- Keep task history compact and use real lifecycle states; completed content must not look permanently busy.
- Preserve hover, focus, selection, loading, disabled and error treatments from the reference.
- Important flows must not rely on ambiguous icon-only controls when the reference provides labels.
- Do not add decorative categories, settings, metrics or explanatory cards absent from the target.

## Core Paths

### Startup And Projects

- Clean startup must match the target's empty/recent-project behavior and must not preload showcase content.
- `新对话`, project-level new chat and the target keyboard shortcut create the same kind of blank task as the reference.
- Project headings, task rows, search, pin/archive and project switching follow the current target's disclosure and ordering.
- `打开项目…` remains a direct, labelled action when present in the reference.

### Composer And Runs

- Match the target's attachment/more, permission, model/reasoning, voice, send, stop and queued-input behavior.
- Do not expose Rux-specific Agent selection or model-management concepts beyond the captured Codex control.
- Provider-native approvals start the Run and ask only for the concrete command, file, network or tool action.
- Match the target's streaming, plan, tool activity, collapsed rows, errors, feedback and return-to-latest behavior.

### Changes, Environment And Terminal

- Changes must be backed by Runtime Git state and immutable Run evidence, not display-only fixtures.
- Match the reference's diff scope, file operations, review controls and recovery behavior.
- Environment modes, Worktrees, Cloud/Remote, Context sources and branches enter v1 only when verified in the target surface.
- Terminal opens and closes like the reference and is not automatically restored after restart unless the reference does so.

### Account And Settings

- Match the target's Codex authentication states and settings categories.
- Opening the account surface must not silently contact unrelated Providers or inspect secrets.
- Login/logout uses the official Codex boundary and preserves local task history.
- Do not show Auto routing, custom Provider, Board, Improvement or local metrics settings unless verified in the current target.

## Visual Acceptance

- Use the same viewport, state and content for reference and implementation screenshots.
- Compare the images together; screenshots captured at different states are not parity evidence.
- Check sidebar width, top bar, transcript rail, Composer geometry, overlay placement, typography, colors, borders, radii, spacing and icon semantics.
- Reject screenshots that are loading, cropped, stale, blank or show the wrong window.
- The accepted reference may change with the ChatGPT client. Version the evidence rather than treating old anchors as permanent.

## Accessibility Acceptance

- Match visible copy and provide accurate accessible names for every important control.
- Verify keyboard navigation, focus visibility, reading order, state announcements, target sizes, zoom/reflow and contrast on critical paths.
- Hover-only actions must also be reachable by keyboard.
- Do not claim WCAG compliance from screenshots alone.

## Implementation Rules

- Build renderer UI in `src/` and keep Node, filesystem, PTY, process and credentials out of Renderer.
- Use typed Preload/Main/Runtime boundaries and shared validation schemas.
- Preserve `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` and Sites tests unless the task explicitly changes Web delivery.
- Showcase fixtures are allowed only behind an explicit test/showcase flag and must never persist into normal state.
- Existing compatibility components may remain dormant, but new v1 work must not depend on or expose them.

## Verification

- Run `npm test` for renderer behavior or boundary changes.
- Run `npm run build:desktop` for desktop changes.
- Run `npm run build` and `npm run test:sites` when Web/Sites is affected.
- For visible changes, package and launch the actual desktop app, complete the real click path and save same-state comparison evidence under `design-audit/`.
- Packaging, a passing test or an accessibility tree alone does not prove ChatGPT Codex parity.
