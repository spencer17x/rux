# Rux v1 parity completion audit — 2026-08-22

This audit evaluates the active Goal against `docs/product-requirements.md`. Passing tests or the presence of a control is not treated as proof of full parity unless the required user path was also exercised in the packaged app.

Status meanings:

- **Proven** — current source, automated gates, and proportional packaged-app evidence cover the requirement.
- **Partial** — a real implementation exists, but one or more required states or target comparisons are missing.
- **Missing** — the target-visible behavior is not implemented.
- **Externally blocked** — completion requires an unavailable supported interface, target-client evidence, platform service, or release credential.

## Requirement audit

| Requirement | Status | Authoritative current evidence | Remaining proof or work |
| --- | --- | --- | --- |
| Clean startup and explicit project/account actions | Proven | Release-boundary tests; packaged clean-start captures in `design-audit/codex-goal-2026-08-22/` | None for current implementation. |
| Official Codex authentication and logout | Proven | Fake official-boundary tests and packaged login/approval runs; Main/Runtime never read credential files | A real production login was intentionally not mutated during QA. |
| First-level navigation structure | Partial | Packaged sidebar shows New chat, Pull requests, Sites, Scheduled, Plugins | Sites and Scheduled are explicit unavailable surfaces rather than complete target flows. |
| Project grouping, opening, switching, search, pin, archive and recovery | Proven | Persistence and release-boundary tests; packaged two-repository switch evidence `46`–`50` | Target-client same-state visual comparison still missing. |
| Task sharing | Partial | Target `26.818.32112` main screenshot proves the header entry and order; Rux exposes an accessible evidence-gated control | Requires the target click result, audience/link permissions, loading, failure, revoke and recovery states before enabling behavior. |
| Product/workspace switcher | Partial | Target `26.818.32112` screenshot proves the branded label and chevron; Rux preserves the visible control and removed its misleading one-item self-selection menu | Requires the target expanded destinations, selection behavior and recovery states before enabling. |
| New chat without a custom wizard | Proven | Source boundary tests and packaged task creation paths | None. |
| Composer file context | Proven | Native picker, Workspace validation and protected-path tests | None. |
| Clipboard image input | Proven | Main-owned bounded persistence, App Server `localImage`, release-boundary tests | None. |
| Permission selector and per-action approval | Proven | Permission-gate/App Server tests and packaged Allow/Reject/Stop/restart evidence `17`–`21`, `45` | None. |
| Real model catalog, nested model/reasoning/speed controls | Proven | `model/list` and `serviceTier` contract tests, selection persistence, packaged captures | None for implemented path. |
| Composer send, stop and Task-scoped queue | Proven | Renderer queue tests and packaged queue/auto-drain evidence `22`–`25` | None. |
| Composer voice transcription | Partial / externally blocked | Real audio-only permission path and platform SpeechRecognition implementation; packaged error recovery `26` | Successful transcription could not be proven because Chromium's speech service returned `network`. App Server realtime is a different full voice-conversation product, not an equivalent dictation API. |
| Slash review command | Proven | Protocol v25 retains validated `CodexReviewTarget`; App Server `review/start`; packaged evidence `34`–`37` | None. |
| Transcript ordering, reasoning, plans, activities, errors and jump-to-latest | Proven | Event-normalization tests, component boundary tests, packaged final transcript `43` | Same-state target screenshot still missing. |
| Transcript feedback, expand and code-apply actions | Partial | Target screenshot proves visible reply actions; Rux copy actions use the real Clipboard boundary and all unsupported actions are explicitly disabled instead of no-ops | Requires target click results plus supported feedback submission, confirmation/reversal, expand, and code-application semantics. |
| Changes/Review, diff, review acceptance and guarded restore | Proven | 24 Git tests, localized inspector tests, packaged Changes/Restore evidence `30`, `44` | Comment and hunk-level operations are not claimed because same-version target evidence for those controls was not captured. |
| Environment local path, branch, commit/push, compare and sources | Proven | Git tests and packaged Environment evidence `39`, `48`, `50` | Cloud/Remote environment modes remain unverified because the supplied target evidence did not establish account-gated paths. |
| Integrated Terminal, tabs and Workspace isolation | Proven | PTY tests, packaged command evidence `16`, Workspace-specific `pwd` and disposal evidence `49`–`50` | None. |
| Account usage, identity and rate limits | Proven | Explicit user-triggered `account/read` and `account/rateLimits/read` tests; in-memory-only UI; target account-menu evidence in `design-audit/chatgpt-codex-26.818.32112-2026-08-22/` | Account plan and region are not visible in the supplied evidence. |
| Show pet | Partial | Target `26.818.32112` account-menu screenshot proves the entry is visible; Rux exposes the entry with an explicit evidence gate | Requires the target click result, pet lifecycle, persistence, loading and failure states before enabling the behavior. |
| Settings General | Partial | Permission defaults persist; Bottom panel controls Terminal; Speed maps to official `serviceTier`; Prevent sleep is Main-owned and active only for running/blocked Tasks with switch/quit release | File-open default, language switching, menu-bar residency and right Terminal docking remain explicitly gated pending real consumers and target interaction proof. |
| Settings Import | Partial | Official `externalAgentConfig/*` methods, stale-detection guard, protocol v25, packaged evidence `40`–`42` | Automatic updates are documented by OpenAI but App Server 0.147.0 exposes no update-toggle method. |
| Settings Appearance, Voice, Configuration, Personalization, Keyboard shortcuts, Computer history, Appshots, Browser, Computer use, Hooks, Connections and Git | Missing / externally blocked | Controls are visibly disabled with reasons instead of being no-ops | Complete target page evidence and/or supported local methods are required. |
| Plugins catalog and mutations | Proven | Official CLI list/add/remove boundary, confirmation gating, packaged catalog `15` | No real user plugin was mutated during QA. |
| Pull-request surface | Partial | Real, bounded, read-only `gh` list and packaged repository result `27` | Target create/filter/review/checkout semantics are not captured; Rux does not claim them complete. |
| Sites | Missing / externally blocked | Honest packaged unavailable surface `28`; official docs confirm the product exists | App Server 0.147.0 exposes no Sites list/create/manage method. |
| Scheduled tasks | Missing / externally blocked | Honest packaged unavailable surface `29`; official docs confirm the product exists | App Server 0.147.0 exposes no scheduled-task list/create/manage method. |
| Built-in Browser and Side chat | Missing / externally blocked | Quick-tools rows are disabled with accessible reasons `30` | No supported local Browser/Side-chat management interface was found; target click-path evidence is unavailable. |
| Invite friends | Partial / externally blocked | Target `26.818.32112` account-menu screenshot proves the entry is visible; official account schema exposes no eligibility or referral URL | Requires the target click result and an eligible account response or supported referral API before enabling the behavior. |
| Native Session new/resume/reconnect/failure/restart continuity | Proven | Session link, connector, persistence and packaged restart recovery tests/evidence | None for current Codex path. |
| Historical Rux data retained but legacy creation/UI disabled | Proven | Normal hydration is Codex-only; legacy components are not mounted; Main no longer creates the historical 15-minute background Improvement evaluation timer or any dormant Provider contact; compatibility stores remain | A separate destructive migration was not authorized and was not performed. |
| Renderer/Main/Runtime security and Workspace isolation | Proven | CSP, trusted-frame IPC, typed protocol, path validation, credential/process/Git/persistence tests; Preload excludes every unmounted Board/Improvement/Handoff/Provider/hidden-settings compatibility method | None for the active v1 boundary. |
| Critical accessibility paths | Partial | Accessible names, focus traps/live regions/reduced motion; packaged AX verifies primary menus, sidebar transients, semantic navigation/conversation, Inspector/Terminal tabs; packaged screenshots `55`–`66` identify and correct a high-zoom reflow failure | Target-equivalent screen-reader behavior, full application tab order, exact zoom matrix, OS text sizing and measured contrast are not complete. |
| Desktop build and package | Proven | Repeated `npm test`, `npm run build:desktop`, and `npm run package`; final app at `app/release/mac-arm64/Rux.app` | Package remains unsigned. |
| macOS signing and notarization | Externally blocked | Packaging reports zero valid Developer ID identities | Requires the user's Developer ID certificate, Apple credentials and release authorization. |
| Same-version, same-platform, same-account, same-state visual comparison | Partial | User-provided ChatGPT macOS `26.818.32112` main/account captures establish the current version and visible account gate; packaged Rux before/after geometry captures `52`–`53` align sidebar, content rail, footer and Environment proportions | Logical viewport/display scale, plan/region, identical transcript/account/source state, and complete click-state comparisons remain outstanding. |

## Current conclusion

The Goal is **not complete, but the target-version blocker has been removed and work can continue**. Rux has real coverage for the local Codex workbench core, and the supplied `26.818.32112` evidence now establishes the current main/account visual baseline. The measured shell geometry has been aligned and the target-visible Share entry restored with an honest evidence gate. Complete parity still cannot be proven while target-visible Share, Sites, Scheduled, Browser, Side chat, Show pet, Invite and several Settings pages lack supported local interfaces or captured click paths. Successful voice transcription, Import automatic updates, signing/notarization, a complete accessibility matrix, and an identical-state comparison also remain unproven.

No remaining item may be converted to “complete” merely by keeping an unavailable placeholder, inventing a URL, inferring UI from schema names, or substituting a different product capability.
