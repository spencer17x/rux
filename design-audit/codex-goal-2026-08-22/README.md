# Rux Codex parity progress audit — 2026-08-22

## Scope

- Product: Rux desktop/Web fallback renderer.
- Flow: main Task with Environment open, account popover, quick-tools menu, and Settings > General.
- Viewport: 1356 × 768 CSS px for the app captures.
- Target: the user-provided current ChatGPT Codex evidence under `../chatgpt-codex-current-2026-08-19/`.

## Steps

1. **Main Task and Environment — unhealthy before, materially improved after.**
   - `01-current-main.jpg` showed the transcript and Composer centered underneath the Environment overlay.
   - `07-main-after-header.jpg` reserves the verified 300 px Environment rail while keeping the top bar full-width.
   - The sidebar, reading rail, Composer, and Environment anchors now align closely with the normalized reference.
2. **Account popover — healthy.**
   - `02-current-account.jpg` keeps the profile and login rows visible, uses truthful ChatGPT copy, and exposes manual sync without a hard-coded usage percentage.
3. **Quick tools — partial.**
   - `03-current-quick-tools.jpg` exposes the confirmed rows and keyboard labels.
   - Review, Terminal, and Files have actions; Browser and Side chat remain visible without a completed product flow, so this path does not yet satisfy the product contract.
4. **Settings > General — partial before, improved after.**
   - `04-current-settings.jpg` showed an extra update section and a redundant “All settings” row; General preferences were component-local.
   - `05-settings-after.jpg` removes the unverified update surface, matches the reference search/header spacing more closely, and persists file target, language, menu bar, bottom panel, terminal position, prevent-sleep, and speed through the existing UI-preference store.
   - Browser verification changed the file target to Finder, reloaded the page, observed Finder still selected, then restored VS Code.
5. **Same-source comparison — improved geometry, content-state differences remain.**
   - `08-main-side-by-side.jpg` places the normalized target and the post-fix Rux capture in one comparison artifact.
   - Transcript content and lifecycle state differ, so this proves layout movement, not complete product parity.
6. **Legacy product entry cleanup — improved.**
   - `09-composer-more-after.jpg` shows that the active Composer no longer exposes a duplicate reasoning selector, manual Engine model ID, Auto routing, or Agent/Provider management.
   - The always-visible cross-Agent “copy as new task,” local-data management, and Agent Revision upgrade cards were removed from the active Task timeline. Their compatibility services remain internal for historical data.
7. **Untouched new chats — improved.**
   - New-chat actions now reuse an existing message-free, Run-free, draft-free Task in the same Workspace instead of persisting another duplicate blank row.
   - The Web renderer was exercised with repeated new-chat clicks; the task-row count stayed unchanged.
8. **Packaged desktop — healthy for the inspected paths.**
   - `10-packaged-main.jpg` and `11-packaged-settings.jpg` were captured from `app/release/mac-arm64/Rux.app` and confirm the real sandboxed renderer exposes the updated Composer and General settings surface.
   - `12-packaged-main-current-window.jpg` records the current packaged window after returning from Settings.
   - A final package was generated after the blank-task reuse change. Because another Rux instance was already running under the same bundle identity, Computer Use could not uniquely target the isolated relaunch for a second click-path capture; the current bundle was still verified by extraction and the Web interaction path.
9. **Plugins — real desktop catalog implemented.**
   - Official OpenAI documentation defines Plugins as a shared ChatGPT/Codex catalog that supports browsing and installation from the desktop app and loads installed capabilities into new chats: <https://learn.chatgpt.com/docs/plugins>.
   - `13-plugins-web-unavailable.jpg` verifies the Web fallback reports that the desktop catalog is unavailable instead of inventing plugin data.
   - `15-packaged-plugin-catalog-clean.jpg` was captured from an isolated copy of the packaged app. It shows 13 installed and 182 available plugins returned by `codex plugin list --available --json`, without exposing source paths or credentials.
   - Searching the packaged catalog for `github` kept GitHub visible and removed Gmail from the accessibility tree.
   - Install/remove mutations were verified against the fake official CLI boundary and require an explicit in-app confirmation; no real user plugin was installed or removed during this audit.
   - The Runtime protocol introduced bounded `plugin.list`, `plugin.install`, and `plugin.remove` methods, advanced to v23 for pull-request discovery and v24 for validated Codex review targets, and is now v25 after adding official external configuration import.
10. **Native Terminal — healthy for the exercised path.**
   - `16-packaged-terminal-command.jpg` records a real packaged PTY running `printf 'RUX_TERMINAL_OK\\n'` in the authorized Workspace and displaying the expected output.
   - Creating a second terminal produced a second live tab; closing it left one tab.
   - Opening Environment while Terminal was visible removed Terminal from the accessibility tree; reopening Terminal removed Environment, confirming mutual exclusion.
   - Terminal tabs now expose distinct indexed tab and close-button names plus `tablist`/`tab`/`tabpanel` relationships for keyboard and assistive-technology users.
11. **Authentication and command approval — healthy in an isolated packaged boundary.**
   - An isolated packaged app used the repository fake Codex CLI, so no developer login or real credential was changed.
   - The account flow delegated login to the CLI and reached `已连接 · ChatGPT OAuth`. A defect where the Composer still showed `配置连接` after successful login was found and fixed by refreshing `agent.list` after login.
   - `17-packaged-command-approval.jpg` shows a real packaged Run paused on a command approval with command, scope, impact, Reject, Allow once, and Stop controls.
   - Choosing Allow once resumed the exact provider request and completed the Run; `18-packaged-command-approved.jpg` records the completed activity, verification evidence, Run-owned patch, and restored Composer.
   - A second isolated Run chose Reject. The pending approval disappeared, the Run reached an explicit failed terminal state, and the Composer became editable again; `19-packaged-command-rejected.jpg` records that recovery state.
   - A third isolated Run used the header Stop control while approval was pending. The approval controls disappeared, the Run reached the stopped state, and the Composer recovered; `20-packaged-command-stopped.jpg` records the result.
   - A fourth Run was terminated while the command approval was pending, then the same packaged task store was reopened. The task and Run restored as interrupted, the stale approval was absent, and the Composer was editable; `21-packaged-approval-restart-recovery.jpg` records the recovery state. Recovery copy was then normalized to remove provider/Agent implementation language.
12. **Composer queued input — healthy.**
   - `22-composer-queued-input.jpg` records the Web fallback with one cancellable Task-scoped queue entry while the current Run waits for approval.
   - Cancelling removed the queue region. A new queued entry was then sent automatically after the current Run completed and became the next approval-bound Run; `23-composer-queue-auto-drain.jpg` records that sequence.
   - The same path was repeated through an isolated packaged app and real Runtime events. `24-packaged-composer-queued-input.jpg` shows the queued entry and `25-packaged-composer-queue-auto-drain.jpg` shows it removed from the queue, appended as the next user message, and started as Run 2.
   - Queues are isolated by Task and Workspace, capped at ten entries, support attached images, and expose live-region and cancellation names.
13. **Voice input — real capability path, successful transcription not yet proven.**
   - The previous visual-only toggle was replaced with platform SpeechRecognition, explicit audio-only `getUserMedia`, final-result insertion, Stop, teardown, and visible error states.
   - Main grants media access only to the trusted main WebContents and only when every requested media type is audio; camera/video remains denied. The packaged macOS Info.plist contains only the explicit microphone usage description.
   - `26-packaged-voice-input.jpg` records the isolated packaged app after the platform recognizer returned a `network` error. The error was surfaced without leaving a fake active state or inserting fabricated text.
   - Successful audio transcription remains unverified on this machine because the Chromium speech service was unavailable; this path is not counted as complete parity yet.
14. **Keyboard paths — improved.**
   - `Control+Shift+G` now opens the Changes review pane and selects Changes.
   - `Control+Backquote` toggles the real Terminal and closes the right inspector when opening; Review closes Terminal in the opposite direction.
   - Existing `Command+N`, `Command+,`, and Escape paths remain covered by Renderer boundary tests.
   - User-facing approval and completion copy was subsequently normalized to Codex/Chinese terminology; provider-native and historical Agent wording no longer appears in the active timeline.
15. **Pull requests — real read-only discovery implemented.**
   - `27-packaged-pull-requests.png` shows the packaged app reading `spencer17x/rux` through the user's existing official `gh` CLI session and truthfully displaying an empty repository result.
   - Runtime protocol v23 adds `pullRequest.list`; command output is time/size bounded and schema-normalized, and no token or raw CLI environment crosses into Renderer.
   - Automated coverage includes both a missing-CLI result and a fake-CLI response. Creation, review submission, filtering, and exact target-client interaction parity remain unverified.
16. **Sites, Scheduled, Browser, and Side chat — misleading routes removed, capability still incomplete.**
   - `28-packaged-sites-boundary.png` proves Sites no longer opens Environment; `29-packaged-scheduled-boundary.png` proves Scheduled no longer opens Notifications.
   - Both surfaces state that the current official local boundary lacks list/management methods instead of fabricating content.
   - Browser and Side chat remain visible in the confirmed quick-tools menu but are now disabled with accessible reasons instead of acting like functional no-op controls. Their complete flows remain a parity gap.
17. **Changes, Context, and Run inspectors — localized and legacy concepts removed.**
   - `30-packaged-localized-changes.png`, `31-packaged-localized-context.png`, and `32-packaged-localized-run.png` were captured from the final packaged app.
   - Active inspector UI no longer displays Agent snapshots, Provider/Connection/Revision metadata, Auto routing decisions, internal Git tree IDs, or English action labels.
   - Packaged accessibility output confirms the final Run labels are `由 Codex 选择 · 无需验证` and `请求批准`; the first pass exposed and then corrected stale `Engine` and `Ask for approval` labels.
18. **Settings navigation — no-op controls removed.**
   - `33-packaged-settings-disabled-boundaries.png` shows the final packaged Settings surface.
   - General settings, Profile/Account/Usage, and Plugins keep real actions. Import, Appearance, Voice, Configuration, Personalization, Keyboard shortcuts, Computer history, App snapshots, Browser, Computer use, Hooks, Connections, and Git are visibly disabled with specific accessible reasons until their target flows are implemented and verified.
   - This is an honest boundary improvement, not completion of those settings categories.
19. **Composer `/review` — official read-only code review implemented.**
   - Official documentation distinguishes the review pane from the `/review` command: the pane inspects repository changes, while `/review` starts a dedicated reviewer for a base branch, uncommitted changes, a commit, or custom instructions: <https://learn.chatgpt.com/docs/code-review>.
   - `34-packaged-review-command.png` shows the packaged Composer command suggestion and `35-packaged-review-scope.png` shows all four scope choices.
   - `36-packaged-review-result-before-copy-fix.png` records the isolated packaged app after a real `review/start` request through the fake official App Server boundary. The reviewer returned a finding, requested no approval, did not change the worktree, and restored the Composer.
   - Runtime protocol v24 validates `CodexReviewTarget`, rejects non-Codex/image review requests, forces the review Run to read-only, and persists its result through the ordinary Run/Transcript path. A final copy fix localizes the divider to `运行 #n · Codex` and removes the duplicate adapter label; `37-packaged-review-result-final.png` verifies the corrected final package.
20. **Dormant compatibility isolation — tightened.**
   - Project More no longer routes “Edit project” into the historical Working Copies manager, and Invite is disabled with an explicit unverified-flow reason instead of acting as a no-op. `38-packaged-project-menu-boundary.png` verifies the final project popover contains only identity, pin, task count, and path.
   - Normal startup no longer loads Board or Improvement summaries, normal task creation no longer pins Improvement assets, and ordinary Runs no longer inject historical Improvement content.
   - The active Composer now receives only the built-in Codex choice. Historical custom-Agent/Claude/Rux-Native tasks remain preserved for viewing but cannot be resumed through normal v1 controls. Compatibility stores and services remain intact for a separately reviewed migration.
21. **Environment terminology — localized.**
   - `39-packaged-environment-localized.png` verifies the final packaged commit/push panel uses `已暂存`, `暂存区`, `提交信息`, and `上游` consistently.
   - Branch switching, comparison, binary-file labels, Runtime boundary copy, Run occupancy, and Context source links were likewise normalized to Chinese product terminology while retaining exact Git identifiers such as branch names and `HEAD` where technically necessary.
22. **Settings Import — official external setup import implemented.**
   - Official documentation confirms that the desktop Settings > Import flow detects Claude Code, Claude Cowork, and Cursor, lets users select supported setup/projects/recent work, leaves the source unchanged, and exposes import history: <https://learn.chatgpt.com/docs/import>.
   - `40-packaged-import-sources.png` shows all three detected sources in the isolated packaged app; `41-packaged-import-items.png` shows the selected settings, Skills, and recent-chat summaries plus the explicit final confirmation.
   - `42-packaged-import-history.png` verifies 9 successful fake-boundary imports and three source-specific history records in the actual package.
   - Runtime protocol v25 fixes detection to the authorized Workspace plus official user-level scope, retains raw migration objects only in an expiring privileged cache, accepts only opaque detection/item ids from Renderer, and waits for the official completion notification. No real developer configuration was imported during QA.
   - The official docs mention automatic updates, but current App Server 0.147.0 exposes no corresponding toggle method; the setting remains visibly disabled with an explicit reason rather than claiming synchronization.
23. **Transcript lifecycle copy — localized.**
   - Active running, blocked, stopped, failed, and interrupted fallback copy now names Codex and normalizes Run/Runtime/Session terminology to 运行、运行环境和会话.
   - Reasoning, activity, plan progress, turn counts, imported-copy continuity, session recovery, and Run-change attribution are localized without altering stored evidence.
   - `43-packaged-transcript-final.png` verifies the final package still restores the review result, shows `运行 #1 · Codex`, retains the workspace-evidence warning, and exposes an editable Composer.
24. **Restore and approval safety copy — localized and reverified.**
   - `44-packaged-restore-preview.png` shows the real packaged preview for a tracked file. It identifies the exact path, states that the Git staging area is preserved, and requires a second confirmation; QA cancelled without changing the file.
   - `45-packaged-approval-localized.png` records a fresh fake-boundary command approval with Codex wording, operation, exact command scope, single-action duration, Reject, and Allow once. Reject removed the pending request and restored the Composer.
   - Invite remains disabled. Official OpenAI material describes referrals as dynamically gated by campaign, plan, workspace, account, and region; App Server account data contains no eligibility or referral URL, so Rux cannot safely synthesize a flow.
25. **Packaged Workspace switching — healthy.**
   - Two isolated real Git repositories were authorized in a dedicated Electron user-data directory: `alpha-workspace` on `main` and `beta-workspace` on `feature-beta`.
   - `46-packaged-workspace-alpha.png` records the initial alpha task and both project groups. `47-packaged-workspace-beta.png` records the beta starter task after switching without carrying alpha task state into the active Workspace.
   - `48-packaged-workspace-beta-environment.png` verifies beta's canonical path, zero Changes, and `feature-beta` branch. `49-packaged-workspace-beta-terminal.png` shows a real PTY `pwd` result under the beta path.
   - Switching back to alpha disposed the beta Terminal instead of restoring it in the new Workspace; `50-packaged-workspace-alpha-restored.png` verifies the alpha task and `main` Environment state returned.
26. **Confirmed `26.818.32112` account-menu baseline — structure aligned, downstream behavior still gated.**
   - User evidence under `design-audit/chatgpt-codex-26.818.32112-2026-08-22/` establishes the official target version and proves the account-menu order: identity, 使用情况, 显示宠物, 邀请好友, 设置, 退出登录.
   - Rux now uses that order and no longer exposes the target-absent standalone `同步 ChatGPT` row. Selecting 使用情况 remains the explicit action that refreshes the bounded in-memory account/rate-limit snapshot.
   - The actual repackaged app was launched and its accessibility tree confirmed the complete order and accessible reasons. `51-packaged-26.818-baseline-main.jpeg` records the launched package; the macOS menu overlay did not return a raster frame through Computer Use, so its structure is recorded as accessibility evidence rather than claimed as a same-state image comparison.
   - 显示宠物 and 邀请好友 remain disabled with explicit evidence-gate descriptions. The supplied target screenshot proves the entries exist, but not what either click does; their behavior is not counted as complete.
27. **Main shell and Environment geometry — corrected against `26.818.32112`.**
   - `52-packaged-environment-before-26.818-geometry.jpeg` records the actual package before the new-version geometry pass. The sidebar/content rail were too narrow, the account footer too tall, and the Environment card too tall.
   - Rux now uses a 241 px sidebar, 736 px transcript/Composer rail, 46 px account footer, and 397 px Environment card. `53-packaged-environment-after-26.818-geometry.jpeg` verifies the repackaged result without clipping.
   - The target also proves a Share control before `打开位置`; Rux now preserves that visible position with an accessible evidence gate instead of mapping it to an unrelated export or sync flow.
   - The full comparison and evidence limits are recorded in `design-audit/chatgpt-codex-26.818.32112-2026-08-22/04-rux-main-environment-comparison.md`.
28. **Normal v1 hydration and render tree — Codex-only boundary tightened.**
   - Desktop hydration now restores only authorized Workspace/Task state and filters cached or detected adapters to Codex. It no longer enumerates custom Agent Profiles, native Provider Connections, hidden local metrics, hidden updater state, Board, or Improvement data during startup or Settings opening.
   - Historical New Task, Board, Working Copies, Improvement, Handoff, custom Agent, and old Session-discovery dialogs are no longer mounted in the active React tree. Their underlying compatibility stores and services remain untouched so historical data is not destroyed.
   - Task persistence no longer contains a conditional Board refresh. Active account login refreshes only the Codex adapter, and visible startup/logout/Settings copy no longer exposes historical Agent terminology.
   - The final minified Renderer contains none of the legacy product-entry strings `Agent 与 Provider`, `改进中心`, `项目看板`, `Rux Native Provider`, `自定义 Agents`, `工作副本`, `切换 Agent`, or `管理 Agent`. Its bundle dropped from roughly 1.87 MB to 1.71 MB after the inactive surfaces and multi-Agent choice construction were removed.
   - `54-packaged-settings-codex-only.jpeg` records the actual final package's Settings surface. Computer Use confirmed a clean Task and Settings accessibility tree with no mounted legacy entry while preserving Composer, Share, Environment, General, Import, Account, and Plugins controls.
   - The visible 使用情况 action now stops after the bounded official App Server account/rate-limit snapshot. It no longer chains into the generic authentication status path, so a ChatGPT usage check cannot probe Claude or other compatibility CLIs.
29. **Critical keyboard and semantic paths — strengthened and packaged-app verified.**
   - The first-level sidebar is now a named navigation landmark. The transcript is a named, keyboard-focusable scroll region and exposes its running/blocked busy state without replacing the existing streaming-message announcement.
   - Opening the account menu moves focus to its first enabled item. Arrow Down moved focus to 使用情况, End moved it to 退出登录, and Escape closed the menu and returned focus to the 账户菜单 trigger in the actual final package. Disabled 显示宠物 and 邀请好友 were skipped.
   - Static release gates cover the semantic elements, focus restoration, direction/Home/End handling, and visible focus treatment. This improves a key path but does not claim complete screen-reader, zoom/reflow, or contrast parity.
30. **Composer nested-menu keyboard paths — fixed and verified through the final package.**
   - Permission opens on the checked 请求批准 item, Arrow Down moves to 完全访问, and Escape closes the menu and restores the 批准方式 trigger without selecting a new permission.
   - Model opens on 模型; Arrow navigation reaches 速度; Enter opens the speed submenu on its checked 标准 item. The first Escape returns to the exact 速度 parent item and the second closes the model menu and restores the accessible `选择模型：5.6 Sol 轻度` trigger.
   - An initial packaged run exposed two real focus bugs: a generic focus effect overwrote the speed-parent return, and the global Escape handler could close Environment when a synthesized key event targeted the document root. Both were corrected and the full two-level path was rerun. Environment remained open after both menu Escapes.
31. **Inspector and Terminal ARIA tabs — roving focus verified.**
   - Changes/Context/Run and Terminal tabs now expose only the selected tab in the ordinary Tab sequence. Arrow Left/Right wraps through tabs; Home/End selects the first/last tab and moves focus with the panel state.
   - In the packaged Inspector, Right moved selected focus from Changes to Context and End moved it to Run. Opening Terminal closed the right inspector as expected.
   - Creating a second Terminal activated its real `Terminal input`. After explicitly focusing terminal tab 2, Left selected and focused tab 1. Closing that active tab selected and focused the surviving tab, which was correctly renumbered as terminal 1.
32. **Task-header menus — mutually exclusive keyboard paths verified.**
   - Task actions opens on 重命名; End reaches 归档任务; Escape restores the exact task-action trigger. Rename mode remains a dialog/form and is excluded from menu-arrow handling.
   - Open location opens on VS Code; Arrow Down reaches Finder; Escape restores 打开位置 without launching either external application.
   - Quick tools opens on 审阅. End skips disabled 浏览器 and 侧边聊天 and lands on 文件; Escape restores 快捷工具. Opening any of the three menus closes the other two first, preventing ambiguous Escape ownership.
33. **Product switcher placeholder — misleading self-menu removed.**
   - The `26.818.32112` screenshot proves the top-left branded label and chevron but not the expanded destinations. Rux previously opened a one-item menu containing only `Rux 工作台 · 当前工作台`, which could never switch anything and was not target evidence.
   - The final package preserves the visible `Rux` label and chevron as a disabled, evidence-gated control with the accessible reason `工作台切换结果尚缺当前客户端点击证据`. Packaged AX confirms no `工作台` menu is mounted and the five confirmed first-level navigation entries remain intact.
34. **Visible no-op buttons — eliminated.**
   - Reply/code copy actions retain real Clipboard handlers. The previously handler-less 应用代码片段, 赞, 踩 and 展开回复 controls are now disabled with specific target-evidence or interface reasons rather than silently accepting clicks.
   - A packaged failed Task confirms 复制回复 remains enabled while 赞, 踩 and 展开回复 are announced as disabled with their reasons. A Babel JSX AST scan found no remaining visible `<button>` lacking a handler, disabled state, or submit behavior.
   - The completion audit now separates proven Transcript rendering/order from the still-partial feedback, expansion and code-application behaviors.
35. **Sidebar Search and Notifications — Escape/focus paths verified.**
   - Search, Notifications and Account now close one another before opening, preventing overlapping transient surfaces. The application-level Escape handler yields while Search or the notification popover is mounted.
   - Packaged Search moved focus directly into the `搜索任务` input. Escape unmounted the input, cleared its state and restored the Search toggle with value off.
   - Packaged Notifications exposed the truthful `通知 · 暂时没有新通知` empty state. Escape removed the popover and restored the 通知 button.
36. **High zoom/reflow — broken state corrected and recaptured.**
   - `55-packaged-zoom-100.jpeg` and `56-packaged-zoom-step-3.jpeg` establish healthy actual-size and intermediate states. `57a-packaged-zoom-step-5-before.jpeg` records the high-zoom failure: vertical single-character recovery copy, clipped header/actions and overflowing Composer controls.
   - Final narrow-viewport rules reflow recovery and Changes cards, compact the header and Composer, preserve full accessible names for visually collapsed controls, and keep Transcript independently scrollable.
   - `66-packaged-zoom-step-5-final.jpeg` is the accepted final high-zoom capture. The audit and its limitations are recorded in `design-audit/chatgpt-codex-26.818.32112-2026-08-22/05-rux-zoom-reflow-audit.md`.
37. **General Settings — persisted no-ops separated from real behavior.**
   - Packaged AX confirms Default file target, Language, Menu bar residency and Right Terminal are disabled with specific missing-consumer reasons. They are no longer counted as implemented merely because a value can be stored.
   - Bottom panel was toggled off in Settings; the title-bar Terminal control disappeared while Quick tools and Composer remained available. Restoring the setting restored the Terminal control.
   - Default Speed was changed to 快速. A newly created/reused blank Codex Task showed `速度 快速` in the real Composer model menu, proving the setting selected the catalog's non-default `serviceTier`. QA then restored 标准, which removed the fast tier from the current blank Task.
38. **Dormant background Improvement execution — removed from Main startup.**
   - Main still created a 15-minute timer that could call the historical model evaluator when old retained settings enabled background review. This remained reachable even though the Renderer surface was removed and violated the v1 no-background-Provider rule.
   - The timer, running flag, background evaluator and quit cleanup branch were removed. Explicit compatibility stores/methods remain, so historical data is preserved while normal startup cannot initiate Improvement Provider work.
39. **Prevent sleep — Main-owned active-Run boundary implemented.**
   - Protocol/preload expose one boolean `preventSleepSet` intent. Main alone owns Electron `powerSaveBlocker`, uses `prevent-display-sleep`, reuses an active blocker id, and stops it when no longer requested.
   - Renderer requests prevention only when the setting is enabled and the active Workspace contains a running or approval-blocked Task. Workspace activation, Renderer teardown and application quit all force `false` cleanup.
   - Packaged Settings confirms the switch is enabled and accurately says it applies only during Codex running/approval states. QA toggled it off/on and restored it to on without starting a real task; provider/runtime tests and static Main boundary gates passed.
40. **Preload API — dormant compatibility methods removed.**
   - `window.rux` now exposes only v1 Workspace/task/image/power operations and the validated Runtime request/event bridge. It no longer exposes Board, Working Copies, Improvement, old Session/Handoff, local-data, custom Provider, hidden metrics or updater mutations.
   - Main-owned stores and handlers remain so retained historical data is not destroyed, but a sandboxed or compromised Renderer cannot reach them through Preload. Release gates inspect both the concrete preload object and `RuxDesktopApi` interface.
   - The complete test suite and a fresh macOS package passed after this boundary reduction. The packaged app then launched successfully; AX inspection verified the primary Workspace navigation, account menu, General Settings truth states, and return to the Workspace.

## Verification

- `npm test`: passed.
- `npm run build:desktop`: passed.
- `npm run package`: passed; the resulting `app/release/mac-arm64/Rux.app` remains unsigned because this machine has no valid Developer ID identity.
- Browser console: no errors or warnings during the accepted Settings capture.
- Packaged-app launch, Settings, plugin catalog, pull-request discovery, honest unavailable surfaces, localized inspectors, Native Terminal/PTY, command approvals, queued input, restart recovery, and the revised account-menu accessibility structure were exercised during this goal. The official `26.818.32112` baseline is now captured, but a matched same-state Rux image and successful voice transcription remain required before the goal can complete.
- Computer Use could not read `com.openai.codex` because the application is blocked by the local safety boundary. The click paths behind the target client's first-level navigation therefore remain unverified in this run.

## Highest-impact remaining work

1. Capture the target click results for 显示宠物 and 邀请好友, including eligibility, lifecycle, loading, failure and persistence states; then replace the current evidence gates with verified behavior.
2. Replace the disabled Browser and Side chat quick-tool rows with verified real flows when a supported local boundary is available.
3. Complete the target click paths behind Pull requests, Sites, and Scheduled. Pull requests now have a real read-only list; create/review/filter parity remains. The generated Codex App Server 0.147.0 schema exposes `review/start` and plugin methods, but no Sites, Scheduled, or built-in Browser management API.
4. Finish Settings category routing and persistence beyond the General page using same-version evidence.
5. Capture a Rux image at the target's logical viewport/state once display scale and viewport are known, and compare it directly with the `26.818.32112` reference.
