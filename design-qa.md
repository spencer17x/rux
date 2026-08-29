# Rux Product Design QA

## Comparison target

- Source visual truth: `/Users/17a/projects/rux/design/rux-agent-ui/04-project-conversation.png`
- Supporting source states:
  - `/Users/17a/projects/rux/design/rux-agent-ui/01-add-project.png`
  - `/Users/17a/projects/rux/design/rux-agent-ui/06-review-changes.png`
  - `/Users/17a/projects/rux/design/rux-agent-ui/08-model-connections-settings.png`
- Browser-rendered implementation:
  - `/Users/17a/projects/rux/qa/implementation-main-final.png`
  - `/Users/17a/projects/rux/qa/implementation-add-project-final.png`
  - `/Users/17a/projects/rux/qa/implementation-review-v2.png`
  - `/Users/17a/projects/rux/qa/implementation-settings-final.png`
- Side-by-side evidence:
  - `/Users/17a/projects/rux/qa/compare-main.png`
  - `/Users/17a/projects/rux/qa/compare-add-project.png`
  - `/Users/17a/projects/rux/qa/compare-review.png`
  - `/Users/17a/projects/rux/qa/compare-settings.png`
- State: light desktop UI, project `rux`, project conversation `实现模型连接设置`; focused comparisons cover add-project, review, and settings states.

## Normalization

- Browser viewport: `1440 × 812` CSS px.
- Device scale factor: `1`.
- Source images: `1670 × 942` px, normalized proportionally into `1440 × 812` with white padding only where needed.
- Implementation captures: `1440 × 812` px.
- Responsive check: `1000 × 700` CSS px; document dimensions remained exactly `1000 × 700` with no page overflow.

## Full-view comparison evidence

The project-conversation comparison confirms the same dominant regions and hierarchy: 250 px pale sidebar; expanded project tree with indented project conversations; white conversation canvas; compact top toolbar; bottom composer and collapsed terminal; floating environment panel. Modal, review, and settings comparisons preserve the same typography, neutral palette, radii, border weight, and control density as their selected mock states.

## Focused-region comparison evidence

- Add-project modal: compared choice-row sizing, radio state, close control, footer alignment, blur/dim treatment, black primary action, and Chinese copy.
- Review workspace: compared tabs, file list, two-column diff, semantic green/red fills, footer actions, and right environment panel.
- Model settings: compared separate settings navigation, OAuth row, custom Base URL/API-key form, model selector, reasoning segmented control, and override toggle.
- No additional raster-image crop was needed: the selected UI targets contain product UI and standard icons rather than custom photography, illustration, or brand artwork. Icons use one Phosphor outline family.

## Findings and comparison history

### Iteration 1

- [P2] Review state omitted the environment panel.
  - Evidence: source review mock retained `环境信息`; first implementation capture used the full width for the diff.
  - Fix: allowed the project environment panel to remain visible in review mode.
  - Post-fix evidence: `qa/implementation-review-v2.png` and `qa/compare-review.png`.
- [P2] Expanded terminal showed environment information instead of the reference tool launcher.
  - Evidence: source terminal mock shows `审查 / 终端 / 浏览器 / 文件 / 侧边聊天`.
  - Fix: added a dedicated terminal-state tool launcher and made `终端` active.
  - Post-fix evidence: `qa/implementation-terminal-v2.png`.
- [P2] Browser-default blue focus rings drifted from the neutral macOS visual language.
  - Evidence: initial standalone and terminal captures showed saturated blue outlines after clicks.
  - Fix: replaced them with a restrained neutral focus-visible outline while retaining keyboard focus affordance.
  - Post-fix evidence: final main, review, and modal captures.

### Final pass

- Fonts and typography: passed. System SF/PingFang stack, weights, 14–16 px body scale, line height, truncation, and headings align with the mocks.
- Spacing and layout rhythm: passed. Main regions, nested sidebar ownership, modal proportions, composer placement, diff layout, and settings groups are consistent; no viewport clipping at 1440 or 1000 px widths.
- Colors and visual tokens: passed. Warm white/gray palette, hairline borders, semantic green/red/orange, selected fills, and restrained elevation match the target.
- Image quality and asset fidelity: passed. The target has no custom raster artwork requiring reproduction; standard UI icons use the consistent Phosphor outline library with no handcrafted SVG/CSS icon substitutes.
- Copy and content: passed. Project and standalone conversations are visibly separated, project conversations are nested under their project, and all eight designed states use coherent Chinese labels.
- Interaction and accessibility: passed. Project expansion, thread switching, add/import/create flow, project association, model popover, review/apply, terminal toggle, settings forms, OAuth state, toggles, and reasoning controls were exercised. Semantic controls and labels are present; keyboard focus remains visible.
- Browser console: no warnings or errors observed after the final interaction pass.

## Primary interactions tested

1. Open add-project modal, continue to import, return, choose create, and edit the project form.
2. Switch between a project conversation and an independent conversation.
3. Create a nested project conversation and return to an existing project conversation.
4. Open and close the per-session model popover.
5. Enter review mode, switch files, and return to conversation.
6. Expand and close the terminal split view.
7. Open model and connection settings, inspect inputs, OAuth state, model controls, and return to Rux.

## Follow-up polish

- [P3] The generated mock uses slightly softer text antialiasing than the browser capture; this is expected raster-versus-live-text variance.
- [P3] The implementation keeps some controls a few pixels taller to preserve comfortable interactive targets.

## Implementation checklist

- [x] All eight requested screen states are represented by working UI states.
- [x] Project conversations are nested beneath their owning project.
- [x] Independent conversations remain in their own section.
- [x] Core flows are interactive rather than static chrome.
- [x] Web and Electron builds pass.
- [x] Browser-rendered screenshots and side-by-side visual comparisons are saved.

final result: passed

---

# Project Tree Interaction Design QA — 2026-08-29

## Comparison target

- Source visual truth:
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-914721f3-e456-4ed6-84e8-83f9f44236cf.png`
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-7a46ad81-9253-4a60-99ad-4e395df73146.png`
- Explicit negative reference: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-a347f956-757d-4027-8730-dbd607c89acc.png` — the project-summary popover shown here must not be implemented.
- Packaged implementation:
  - `/Users/17a/projects/rux/qa/product-design-sidebar/implementation-final-full.jpeg`
  - `/Users/17a/projects/rux/qa/product-design-sidebar/implementation-menu-portal-final.png`
- Combined comparison evidence:
  - `/Users/17a/projects/rux/qa/product-design-sidebar/comparison-project-tree-final.png`
  - `/Users/17a/projects/rux/qa/product-design-sidebar/comparison-menu-final.png`
- State: packaged macOS client, light theme, expanded project with active child conversation; project action menu open for the focused comparison.

## Normalization

- Application window: configured `1440 × 900` CSS px; full CUA capture `1364 × 768` px for the closed-menu tree state.
- Project-tree source: `472 × 1034` px at approximately 2× density, normalized to a `236` CSS-px sidebar.
- Menu source: `1162 × 878` px Retina crop; menu measures approximately `182` CSS px wide.
- Window-specific menu capture: `3104 × 1846` px including Retina window shadow; focused crops were normalized to a common 500 px height before side-by-side comparison.

## Full-view and focused evidence

- Full-view comparison confirms the same hierarchy: muted `项目` heading, 40 px project row, outline folder icon, text-only child conversations, 31 px child rhythm, and a full-row neutral selected state.
- Focused menu comparison confirms the ellipsis menu opens across the sidebar boundary with a translucent white surface, 14 px radius, separated action groups, consistent outline icons, destructive red action, and no project-summary card.
- The target contains only standard UI icons; the implementation uses the existing Phosphor outline family. No raster asset substitution was needed.

## Findings and comparison history

### Iteration 1

- [P2] The inherited project-row rule reduced the intended 40 px project row and made project/current-thread labels too heavy.
  - Fix: restored the 40 px row, regularized project and selected-child weights, removed child chat icons, and removed tree guide lines.
  - Post-fix evidence: `qa/product-design-sidebar/comparison-project-tree-final.png`.
- [P1] The first menu implementation was clipped at the sidebar scroll boundary.
  - Fix: rendered the menu through a body portal with fixed coordinates derived from the ellipsis trigger; retained outside-click close, Escape close, focus restoration, and right-click positioning.
  - Post-fix evidence: `qa/product-design-sidebar/implementation-menu-portal-final.png` and `qa/product-design-sidebar/comparison-menu-final.png`.

## Final pass

- Fonts and typography: passed. System SF/PingFang rendering, regular project/conversation weights, 14–15 px hierarchy, truncation, and row labels match the reference density.
- Spacing and layout rhythm: passed. Project rows are 40 px with 11 px radii; child rows are 31 px with aligned 38 px text inset; menu dimensions and grouped spacing match the source language.
- Colors and visual tokens: passed. Muted heading, neutral hover/selection fill, translucent menu surface, hairline separators, and destructive red action align with the supplied screenshots.
- Image quality and asset fidelity: passed. Both target and implementation use code-native standard outline icons; there are no custom image assets or handcrafted SVG/CSS substitutes.
- Copy and content: passed with intentional capability-bound differences. The menu includes only implemented Rux actions (`新建会话`, open directory, copy path, remove project) rather than presenting unsupported pin/section/archive/worktree controls.
- Interaction and accessibility: passed. Project row toggles only expansion; it does not open the rejected summary popover. Ellipsis opens the action menu, pencil opens the existing draft-preview flow, Escape restores trigger focus, and keyboard traversal reaches both project actions.

## Primary interactions tested

1. Focus the project ellipsis by keyboard and open the portal menu.
2. Verify all four real menu actions and separators are exposed to accessibility APIs.
3. Close with Escape and confirm focus returns to the project action trigger.
4. Activate the project row and confirm it collapses/expands without showing a project-summary popover.
5. Re-expand the project and preserve the active conversation.

## Follow-up polish

- [P3] The reference menu overlaps the project row by a few more pixels; the implementation starts just below the trigger to reduce accidental pointer overlap.
- [P3] Live system-font antialiasing remains slightly crisper than the downsampled Retina reference.

final result: passed

---

# Workspace Panels Design QA — 2026-08-25

## Comparison target

- Source visual truth:
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-2332184e-9b4e-4a5d-9752-8b4993f37a67.png`
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-10c7c680-ccef-4b0f-ae11-8ae1422531b7.png`
- Packaged implementation:
  - `/Users/17a/projects/rux/uat/2026-08-25-full-audit/final-16-dual-panel-shell.png`
  - `/Users/17a/projects/rux/uat/2026-08-25-full-audit/final-17-bottom-workspace-dock.png`
  - `/Users/17a/projects/rux/uat/2026-08-25-full-audit/final-18-workspace-side-chat.png`
- Combined comparison: `/Users/17a/projects/rux/uat/2026-08-25-full-audit/final-compare-dual-panel.png`
- State: packaged macOS client, light theme, project conversation, right tools panel open; bottom Dock captured separately in terminal and side-chat states.

## Normalization

- Implementation viewport and capture: `1364 × 768` px at application scale 1.
- Source: `2880 × 1622` px Retina capture, normalized to `1364 × 768` for full-view comparison.
- Standard icons come from Phosphor; the target contains no non-standard raster assets requiring recreation.

## Full-view and focused evidence

- Full view confirms separate bottom-panel and right-panel buttons, persistent Codex-style right tool navigation, compact composer, and unchanged project/conversation hierarchy.
- Focused bottom-Dock capture confirms the terminal is one selectable tool rather than a terminal-specific persistent footer.
- Side-chat capture confirms the same tool model is shared by the right navigation and bottom tabs.

## Comparison history

- [P2] Right workspace panel was initially 225px and visually narrower than the supplied Codex reference.
  - Fix: widened it to 286px while retaining an 800px maximum conversation width.
- [P2] Embedded terminal initially repeated the Dock-level close action.
  - Fix: terminal header is suppressed when embedded; the Dock owns the single close control.
- [P2] Side-chat send button lacked an accessible name.
  - Fix: added `aria-label="发送侧边聊天消息"`.

## Final pass

- Fonts/typography: passed; 14px compact UI baseline and system SF/PingFang stack match the Codex density.
- Spacing/layout: passed; independent panel controls, right navigation proportions, Dock tabs, and content regions remain visible without overlap.
- Colors/tokens: passed; neutral surfaces, selected fills, borders, and key hints match the reference language.
- Image/icon fidelity: passed; source uses standard UI icons and the implementation uses one consistent outline icon family.
- Copy/content: passed; the five required tools are present in both navigation surfaces with the requested Chinese labels.
- Interactions: passed; right panel and bottom Dock toggle independently; review, terminal, browser, files, and side chat were exercised. Side chat returned `SIDE_CHAT_OK` through the real Codex runtime.

final result: passed

---

# Terminal Dock Visual QA — 2026-08-29

## Comparison target

- Source problem-state screenshot: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-abaae7a8-ab18-423d-b078-50b66bcbece7.png`.
- Packaged implementation: `/Users/17a/projects/rux/qa/product-design-terminal/implementation-terminal-final.jpeg`.
- Side-by-side evidence: `/Users/17a/projects/rux/qa/product-design-terminal/comparison-terminal-before-after.png`.
- State: packaged macOS client, light theme, project conversation, right tool launcher visible, terminal selected and bottom Dock expanded.

## Normalization

- Source: `2880 × 1622` Retina screenshot, normalized to `1364 × 768`.
- Implementation: `1364 × 768` CUA screenshot from the packaged Rux window.
- Both views use the same project, conversation, right-panel state, terminal selection, and approximate scroll position.

## Full-view and focused evidence

- Full-view evidence shows the earlier terminal as a full-bleed black rectangle with a hard white-to-black seam and excessive vertical weight.
- The implementation keeps the terminal dark for code legibility but places it inside a 12 px rounded card on a light-gray tool tray, with 10 px outer breathing room and a reduced 232 px Dock height.
- No focused crop was necessary because the full-width comparison clearly shows the relevant boundaries, tabs, black-area proportion, prompt contrast, and container transition.

## Findings and comparison history

### Iteration 1

- [P1] Full-bleed terminal visually severed the conversation from the bottom workspace.
  - Fix: inset the xterm surface in a bordered, rounded card with a restrained shadow and light tray background.
  - Post-fix evidence: `qa/product-design-terminal/comparison-terminal-before-after.png`.
- [P2] White tab strip and pure dark terminal formed an abrupt contrast edge.
  - Fix: extended the neutral tray through the tab area and changed the active tab to a small white elevated control.
- [P2] Terminal occupied too much vertical space relative to its sparse content.
  - Fix: reduced terminal Dock basis from 260 px to 232 px and increased internal padding instead of empty black area.
- [P2] Terminal palette and typography felt harsher than the surrounding product.
  - Fix: moved to `#202327`, softened foreground/cursor/selection colors, and increased SF Mono size and line height slightly.

## Final pass

- Fonts and typography: passed. SF Mono remains appropriate; 12.5 px sizing, 1.3 line height, and subtle letter spacing improve scanability without changing terminal density materially.
- Spacing and layout rhythm: passed. The terminal is visually contained, the light tray bridges the conversation and terminal, and the reduced height preserves more conversation context.
- Colors and visual tokens: passed. Neutral tray, soft charcoal terminal, mint cursor, muted foreground, and low-elevation shadow fit the existing light Rux system.
- Image quality and asset fidelity: passed. The surface contains no custom imagery; existing Phosphor icons and xterm rendering remain native and sharp.
- Copy and content: passed. Tool labels and terminal content are unchanged.
- Interaction and accessibility: passed. Terminal input, PTY output, resize handling, keyboard shortcut, close control, and accessible output mirror remain intact. The real Electron PTY command flow passed after the visual changes.

## Primary interactions tested

1. Expand the terminal through `Ctrl+\`` — healthy.
2. Verify xterm mounts, fits, and exposes the terminal input — healthy.
3. Execute a real PTY command and observe output — healthy.
4. Preserve right-panel navigation and bottom-Dock close controls — healthy.

## Follow-up polish

- [P3] A future draggable height handle could give users manual control over Dock height; this was not added because resize behavior is not currently implemented end to end.

final result: passed

---

# Light Terminal Theme QA — 2026-08-29

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-8fc58293-27d4-4c11-b4b4-fd74a6853b6d.png`.
- Packaged implementation: `/Users/17a/projects/rux/qa/product-design-terminal-light/implementation-terminal-light-final.jpeg`.
- Side-by-side comparison: `/Users/17a/projects/rux/qa/product-design-terminal-light/comparison-terminal-light-final.png`.
- State: light desktop theme, project conversation, right environment/tool panel visible, terminal selected in the open bottom Dock.

## Normalization

- Source: `2880 × 1622` Retina screenshot, normalized to `1364 × 768`.
- Implementation: `1364 × 768` CUA capture at application scale 1.
- Comparison image: `2728 × 768`, source and implementation horizontally aligned at equal pixel dimensions.

## Full-view and focused evidence

- Full-view comparison confirms the terminal now participates in the same white canvas, hairline-border, neutral-selection, and gray-icon system as the sidebar, conversation, composer, and right panel.
- The prompt remains the only strongly colored terminal element, matching the reference's use of blue/green/red ANSI semantics on a white background.
- No separate focused crop was required because the terminal occupies the full lower region and its typography, boundary, selected tab, prompt colors, and background are clearly legible in the normalized full-view comparison.

## Findings and comparison history

### Iteration 1

- [P1] The previous dark terminal card still violated the supplied all-light product theme.
  - Fix: removed the dark background, inset card, radius, border, and shadow; restored one continuous white workspace surface.
  - Post-fix evidence: `qa/product-design-terminal-light/comparison-terminal-light-final.png`.
- [P2] The dark-card active tab and tray treatment did not match the reference's neutral toolbar.
  - Fix: restored a white 42 px Dock header, hairline divider, and gray selected tab without elevation.
- [P2] ANSI colors and cursor were tuned for a dark background.
  - Fix: introduced a complete light ANSI palette, dark gray foreground, gray cursor, and pale blue selection while preserving semantic command colors.

## Final pass

- Fonts and typography: passed. SF Mono at 12.5 px with 1.3 line height matches the compact reference terminal and remains legible on white.
- Spacing and layout rhythm: passed. The Dock is a continuous lower workspace with a 42 px header, 20 px terminal inset, and no competing container chrome.
- Colors and visual tokens: passed. White surface, neutral borders, gray selected tab, dark text, and restrained ANSI colors match the surrounding Rux light theme.
- Image quality and asset fidelity: passed. The target contains standard product UI and code-native terminal text only; no image assets or substitute drawings were required.
- Copy and content: passed. Existing Rux tool labels remain unchanged; terminal output retains native shell content.
- Interaction and accessibility: passed. `Ctrl+\`` opens the terminal, PTY input/output and resize remain functional, and the screen-reader output mirror is unchanged. All three packaged Electron flows passed.

## Primary interactions tested

1. Open terminal with `Ctrl+\`` — healthy.
2. Confirm terminal input focus and xterm mounting — healthy.
3. Execute a real project command and read its output — healthy.
4. Close and reopen the bottom Dock while preserving right-panel state — healthy.

## Follow-up polish

- [P3] The reference uses a session-specific terminal tab label; Rux keeps the shared workspace-tool tabs so users can switch between review, terminal, browser, files, and side chat in the same Dock.

final result: passed

---

# Default Collapsed Layout Controls QA — 2026-08-29

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-8ba9061c-669c-4b1d-907f-12f3b6262162.png`.
- Packaged implementation: `/Users/17a/projects/rux/qa/product-design-layout-controls/implementation-default-collapsed.jpeg`.
- Full comparison: `/Users/17a/projects/rux/qa/product-design-layout-controls/comparison-layout-controls.png`.
- Focused top-right comparison: `/Users/17a/projects/rux/qa/product-design-layout-controls/comparison-top-right.png`.
- State: initial packaged-app launch with left navigation, bottom Dock, and right workspace tools all closed.

## Normalization

- Source: `2880 × 1622` Retina screenshot, normalized to `1364 × 768`.
- Implementation: `1364 × 768` CUA screenshot at application scale 1.
- Focused toolbar crops were normalized to a common 120 px height before side-by-side comparison.
- The source shows panels open while the user explicitly requested the implementation's default state to be closed; comparisons therefore use the source for control styling and the user request for panel visibility.

## Full-view and focused evidence

- Full-view comparison confirms the collapsed implementation gives the conversation the full window width with no empty side-panel chrome.
- Focused comparison confirms the top-right action order remains compact: copy/share, project location, left layout, bottom layout, right layout, and settings.
- Layout icons use Phosphor `SidebarSimple` variants rather than custom SVG artwork; orientation communicates left, bottom, and right placement.

## Findings and comparison history

### Iteration 1

- [P1] Left navigation was permanently mounted and had no top-right control.
  - Fix: added an independent left-panel state, defaulted it to closed, and added a real top-right toggle plus `⌘B` shortcut.
- [P1] Right workspace tools defaulted open, conflicting with the requested clean launch state.
  - Fix: changed right-panel initialization to closed while preserving its existing toggle and tool behavior.
- [P2] Existing layout icons covered only bottom/right and were handcrafted SVGs.
  - Fix: replaced them with three Phosphor `SidebarSimple` variants and synchronized `aria-pressed` with the visible panel state.
- [P2] Top-right actions lacked complete regression coverage.
  - Fix: expanded Electron tests for initial closed states, left/right/bottom toggles, copy conversation, open-location menu, copy project path, settings, and real PTY use.

## Final pass

- Fonts and typography: passed. Toolbar labels, project title, and control tooltips retain the existing compact Rux system.
- Spacing and layout rhythm: passed. The initial conversation surface uses the full window; the six top-right control groups remain aligned without wrapping or overflow.
- Colors and visual tokens: passed. Neutral inactive icons and gray active backgrounds use existing Rux tokens.
- Image quality and asset fidelity: passed. All layout controls use the installed Phosphor icon system with no handcrafted SVG or raster substitutes.
- Copy and content: passed. Labels accurately describe real actions and do not advertise unavailable capabilities.
- Interaction and accessibility: passed. All three layout buttons expose `aria-pressed`; left, bottom, and right states toggle independently. `⌘B` and `Ctrl+\`` work, and focusable toolbar actions remain keyboard reachable.

## Primary interactions tested

1. Launch with all three panels closed — healthy.
2. Open and close left navigation from the top-right button — healthy.
3. Open right tools and select side chat — healthy.
4. Open bottom terminal and execute a PTY command — healthy.
5. Open the project-location menu and copy the project path — healthy.
6. Copy conversation content and open Settings — healthy.

## Follow-up polish

- [P3] Layout state intentionally resets to collapsed on each launch; persistence can be added later if users prefer restoring their last workspace arrangement.

final result: passed

---

# Environment Information Panel QA — 2026-08-29

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-a59366b4-aa98-4d4d-8073-01a883f8a301.png`.
- Packaged implementation: `/Users/17a/projects/rux/qa/product-design-environment/implementation-environment-final.jpeg`.
- Focused comparison: `/Users/17a/projects/rux/qa/product-design-environment/comparison-environment-final.png`.
- State: left and bottom panels closed, environment information panel open from the selected top-right list button.

## Normalization

- Source panel crop: `615 × 805` px from a `730 × 898` source, normalized to 393 px height.
- Implementation panel crop: `250 × 330` px from a `1364 × 768` packaged-app capture, normalized to 393 px height.
- Focused comparison: `598 × 393` px with equal-height source and implementation panels.
- Git values intentionally differ: the source shows an active Git repository; the captured Rux project is not a Git repository and correctly displays unavailable branch/commit states.

## Full-view and focused evidence

- The packaged full view confirms the selected list button controls only the environment card while left navigation and bottom Dock remain independently collapsed.
- Focused comparison confirms matching card radius, shadow, heading, row density, Git hierarchy, semantic green/red counts, divider, source heading, and source-list treatment.
- Standard Phosphor icons are used throughout; no source images or custom icon assets needed reconstruction.

## Findings and comparison history

### Iteration 1

- [P1] The top-right list button previously opened a generic tool launcher instead of environment information.
  - Fix: replaced the right launcher with a dedicated `EnvironmentPanel` and relabeled the control `切换环境信息`.
- [P1] Environment rows were previously non-functional/missing.
  - Fix: connected real Git status counts, project folder opening, local branch listing/switching, commit/push, and review navigation.
- [P2] The source section had no persistent data model.
  - Fix: user messages now retain selected attachments; Codex native-history loading recovers image/file paths from persisted `userMessage` content.
- [P2] Bottom workspace tools were coupled to the removed right launcher in tests.
  - Fix: bottom Dock remains the real review/terminal/browser/files/side-chat switcher and is tested independently from the environment panel.

## Final pass

- Fonts and typography: passed. Heading, row labels, counts, disabled states, truncation, and source filenames align with the reference hierarchy.
- Spacing and layout rhythm: passed. The floating 248 px card, 39 px rows, 17 px radius, grouped divider, and source spacing closely match the supplied panel.
- Colors and visual tokens: passed. Neutral white card, gray disabled rows, semantic Git green/red, subtle border, and low elevation match the reference.
- Image quality and asset fidelity: passed. Sources use native file/attachment icons; the environment UI uses the existing Phosphor system with no handcrafted SVGs.
- Copy and content: passed. `环境信息`, `变更`, `本地`, branch, `提交或推送`, `比较分支`, and `来源` are all represented with live product data.
- Interaction and accessibility: passed. The toggle exposes `aria-pressed`; the panel is a labeled complementary region; buttons disable when no project/Git repository exists; branch choices use menu semantics; source expansion and add-source controls are keyboard reachable.

## Primary interactions tested

1. Open and close environment information from the top-right list button — healthy.
2. Read real change counts and enter Review — healthy.
3. Open the project directory — healthy.
4. Read/switch local branches and invoke commit/push — healthy when Git is available.
5. Add source files and expand the source list — healthy.
6. Open bottom Dock tools independently, send side chat, and execute a PTY command — healthy.

## Follow-up polish

- [P3] Source thumbnails use file-type icons rather than image previews because the sandboxed renderer does not receive arbitrary local-file bytes.

final result: passed
