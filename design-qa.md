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

# Permission Icon and Enabled-State QA — 2026-08-31

## Comparison target

- Icon-consistency source: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-92c214ba-3142-4d21-bfa4-01e1ed044b82.png`.
- Banner-removal source: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-28f45df2-3be6-4fd0-8905-fe6d3bf935bd.png`.
- Browser-rendered implementation: `/Users/17a/projects/rux/qa/product-design-permissions/permission-icon-consistency-2026-08-31.png`.
- Focused comparison: `/Users/17a/projects/rux/qa/product-design-permissions/permission-popover-focused-comparison-2026-08-31.png`.
- Full-access state without banner: `/Users/17a/projects/rux/qa/product-design-permissions/full-access-without-banner-2026-08-31.png`.
- State: light theme, independent conversation, permission popover open with `请求批准` selected; second capture has confirmed full access with the popover closed.

## Normalization

- Source icon screenshot: `1130 × 674` px at inferred 2× application density.
- Browser implementation: `1130 × 674` CSS px at device scale factor 1.
- Source popover crop: `698 × 498` px, normalized to `350 × 248` px.
- Implementation popover crop: `350 × 248` px.
- Focused comparison: `700 × 248` px with reference on the left and implementation on the right.

## Full-view and focused evidence

- The focused popover comparison confirms matching HandPalm, ShieldCheck, WarningCircle, and Check icons, selected-row fill, typography, copy, spacing, and semantic orange danger treatment.
- Runtime DOM verification confirms the composer button SVG path equals the selected option SVG path for both `read-only` and `danger-full-access`.
- Full-access capture confirms the composer remains in its normal compact position and `.full-access-banner` has zero rendered instances.
- A fresh browser tab rendered the preview without console errors. The permission menu, mode switching, full-access confirmation, and absence of the persistent banner were exercised.

## Findings and comparison history

### Iteration 1

- [P1] The composer always rendered ShieldCheck even when the selected permission option used HandPalm or WarningCircle.
  - Fix: the composer now selects HandPalm for `read-only`, ShieldCheck for `workspace-write`, and WarningCircle for `danger-full-access` from the same Phosphor icon set used by the menu.
  - Post-fix evidence: `permission-popover-focused-comparison-2026-08-31.png`; runtime SVG-path equality is true.
- [P2] The persistent full-access banner repeated information already visible in the orange permission control and consumed vertical composer space.
  - Fix: removed the banner, its close action, special thread layout class, and scroll-button offset. The earlier 2026-08-30 banner recommendation is superseded by this user-selected direction.
  - Post-fix evidence: `full-access-without-banner-2026-08-31.png`; banner count is zero.

## Final pass

- Fonts and typography: passed. Labels, secondary copy, weights, line height, and underlined learn-more action match the reference.
- Spacing and layout rhythm: passed. The normalized `350 × 248` popover, row spacing, radii, and composer control density align with the source.
- Colors and visual tokens: passed. Neutral selected surface and orange danger semantics use the existing Rux tokens consistently.
- Image quality and asset fidelity: passed. All icons are native Phosphor vectors; no raster substitutes, handcrafted SVGs, or CSS drawings were introduced.
- Copy and content: passed. The three permission labels and descriptions remain unchanged; the redundant enabled-state copy is removed as requested.
- Interaction and accessibility: passed. The trigger retains its accessible name, exposes the active mode through `data-permission-mode`, and icon state follows selection without changing menu behavior.

## Primary interactions tested

1. Open permission menu in read-only mode — HandPalm matches the selected row.
2. Select and confirm full access — WarningCircle and `完全访问` are shown in the composer.
3. Confirm no persistent full-access banner is rendered — passed.
4. Switch back to assisted approval — ShieldCheck and `帮我批准` are restored.
5. Fresh preview load and console-error check — passed.

## Follow-up polish

- No actionable P0/P1/P2 differences remain for the requested states.

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

---

# Permission Interaction QA — 2026-08-30

## Comparison target

- Permission-menu sources:
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-3a4d2cd1-3947-49c0-9695-b7448fa5c851.png`
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-7da6eaf0-2ee7-4f2b-81ab-42d8c898c4e6.png`
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-5907dea8-a9bf-4bc6-8dc9-b67418d33349.png`
- Full-access modal source: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-cefabe86-c389-4c48-95a3-906c6cbd8172.png`.
- Enabled-state source: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-b6e9fd18-1dd0-4397-a526-bcbb14a11ee5.png`.
- Packaged implementation: `/Users/17a/projects/rux/qa/product-design-permissions/implementation-full-access-modal-final.jpeg`.
- Side-by-side evidence: `/Users/17a/projects/rux/qa/product-design-permissions/comparison-full-access-modal-final.png`.
- State: permission menu opened from the composer, full-access option selected, confirmation modal visible.

## Normalization

- Source modal was normalized to the packaged app's `1364 × 768` capture.
- Implementation capture is `1364 × 768` at application scale 1.
- Full-view side-by-side evidence is `2728 × 768`; both modal states use the same light theme and centered overlay state.

## Full-view and focused evidence

- Full-view comparison confirms the same warning hierarchy, explanatory copy, three capability rows, risk statement, learn-more action, cancel action, and red confirmation affordance.
- The capability card is clearly readable in the full modal comparison, so a separate focused crop was not needed.
- Icons use the installed Phosphor set; no screenshots or custom SVGs are used inside the product UI.

## Findings and comparison history

### Iteration 1

- [P1] Selecting full access previously used a native `window.confirm` without capability detail.
  - Fix: added a focus-trapped `alertdialog` with explicit file, terminal, and network/app capabilities; settings change occurs only after confirmation.
- [P1] Full access had no persistent reminder after activation.
  - Fix: added a composer-level enabled-state banner with an immediate `关闭` action.
- [P2] The generic modal rule overrode the specialized full-access width and padding.
  - Fix: raised selector specificity with `.modal.full-access-modal`; post-fix evidence is `comparison-full-access-modal-final.png`.
- [P2] The existing scroll-to-bottom control overlapped the enabled-state banner.
  - Fix: added the `has-full-access-banner` layout state and moved the scroll control above the warning banner.
- [P2] Permission menu selected/danger styling did not match the supplied references.
  - Fix: neutral gray selection for regular modes, persistent orange semantics for full access, and a neutral composer chip unless full access is active.

## Final pass

- Fonts and typography: passed. Title, body, capability labels, secondary descriptions, risk copy, and button labels match the reference hierarchy.
- Spacing and layout rhythm: passed. Centered modal, grouped 72 px capability rows, rounded surface, footer divider, and pill confirmation action align with the supplied design.
- Colors and visual tokens: passed. Neutral overlay/card treatment, blue file/network icons, dark terminal icon, and red confirmation semantics match the target.
- Image quality and asset fidelity: passed. All visual assets are native Phosphor icons; no handcrafted SVG/CSS artwork or placeholders were introduced.
- Copy and content: passed. Rux-specific copy accurately describes the real danger-full-access mapping and does not claim capabilities unavailable to the runtime.
- Interaction and accessibility: passed. Cancel and Escape preserve the prior mode; confirmation persists full access; the enabled banner remains visible and can disable full access; focus is trapped/restored; the modal uses `alertdialog` and the menu uses pressed-state semantics.

## Primary interactions tested

1. Switch among request approval and assisted approval — healthy.
2. Select full access and cancel — prior permission remains unchanged.
3. Select full access and confirm — danger-full-access is persisted.
4. Read the enabled-state banner and disable full access — healthy.
5. Verify scroll-to-bottom remains clickable with the banner present — healthy.

## Follow-up polish

- [P3] Settings-page full-access changes still use the settings save action; the high-risk modal is intentionally attached to the primary composer workflow shown in the references.

final result: passed

---

# Permission Icon Source-Match QA — 2026-08-31

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-f6f022b5-b3d0-4dee-93e8-3c215c21ee49.png`.
- Browser-rendered implementation: `/Users/17a/projects/rux/qa/product-design-permissions/permission-icons-final-2026-08-31.png`.
- Focused three-state comparison: `/Users/17a/projects/rux/qa/product-design-permissions/permission-icons-three-state-comparison-2026-08-31.png`.
- State: light theme, permission menu open, `帮我批准` selected; composer trigger and selected row show the same icon asset.

## Normalization

- Source screenshot: `732 × 432` px.
- Browser implementation: `1130 × 674` CSS px at device scale factor 1.
- Each source icon was cropped at `34 × 34` px and each implementation icon at `28 × 28` px, then normalized to `64 × 64` px.
- Focused comparison: `128 × 192` px; each row places the source icon on the left and implementation icon on the right.

## Full-view and focused evidence

- The full browser capture confirms the three icons remain aligned in the existing permission-menu grid and the selected icon is repeated in the composer control.
- The focused comparison confirms matching HandPalm for request approval, terminal-prompt approval shield for assisted approval, and exclamation approval shield for full access.
- Runtime verification confirms the composer and selected row reference the same assisted-approval asset; the active mode is `workspace-write`.
- Browser console error check: no errors.

## Findings and comparison history

### Iteration 1

- [P1] `ShieldChevron` preserved a shield silhouette but its internal chevron and pointed lower section did not match the screenshot's terminal-prompt approval shield.
  - Fix: extracted the supplied terminal-prompt approval shield as a transparent 2× raster asset and reused it in both menu and composer states.
- [P2] The standard `ShieldWarning` had a sharper lower point than the rounded full-access shield shown in the source.
  - Fix: extracted the supplied full-access warning shield as a transparent 2× raster asset.
- Request approval already used the matching Phosphor HandPalm and required no replacement.

## Final pass

- Fonts and typography: passed; no typography was changed by this scoped icon correction.
- Spacing and layout rhythm: passed; icon slots remain `20 px` in menu rows and `16 px` in the composer.
- Colors and visual tokens: passed; the assisted icon follows neutral opacity in the composer, while the full-access asset retains the source orange warning color.
- Image quality and asset fidelity: passed; the two source-specific icons use user-supplied artwork at 2× density with alpha transparency, while HandPalm remains a native Phosphor vector.
- Copy and content: passed; labels and descriptions are unchanged.
- Interaction and accessibility: passed; decorative raster icons use empty alt text and `aria-hidden`, while the permission button retains its accessible label and mode attribute.

## Primary interactions tested

1. Open permission menu — healthy.
2. Select `帮我批准` — source-matched shield appears in selected row and composer.
3. Verify identical trigger/selected asset URLs — passed.
4. Confirm all three mode icons render and the browser console remains error-free — passed.

## Follow-up polish

- No actionable P0/P1/P2 differences remain for the requested icon states.

final result: passed

---

# Project Menu Single-Line QA — 2026-08-31

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-1d3333a2-4047-4d93-96e3-06b4f5d43dc7.png`.
- Browser-rendered implementation: `/Users/17a/projects/rux/qa/project-menu/project-menu-single-line-2026-08-31.png`.
- Focused before/after comparison: `/Users/17a/projects/rux/qa/project-menu/project-menu-wrap-comparison-2026-08-31.png`.
- State: light theme, left sidebar expanded, `rux-demo` project action menu open.

## Normalization

- Source screenshot: `444 × 444` px at inferred 2× application density.
- Browser implementation: `1130 × 674` CSS px at device scale factor 1.
- Source menu crop: `362 × 344` px, normalized to `181 × 172` px.
- Implementation menu crop: `204 × 172` px.
- Focused comparison places the wrapping source menu on the left and the corrected single-line menu on the right.

## Full-view and focused evidence

- The full browser capture confirms the wider menu remains anchored to the project overflow button and does not collide with the sidebar edge or main content controls.
- Focused comparison confirms `在文件管理器中打开` now remains on one line while icon, separators, row heights, and danger action alignment stay consistent.
- Runtime measurements: menu width `204 px`; item width `190 px`; target row height `34 px`; computed `white-space: nowrap`; `scrollWidth` equals `clientWidth`.
- Browser console error check: no errors.

## Findings and comparison history

### Iteration 1

- [P2] The `182 px` menu left exactly the minimum theoretical text width, allowing the system Chinese font to wrap `在文件管理器中打开` onto two lines.
  - Fix: increased the menu to `204 px`, applied `white-space: nowrap`, set a compact `1.25` line height, and prevented the 17 px row icons from shrinking.
  - Post-fix evidence: `project-menu-wrap-comparison-2026-08-31.png` and measured row height `34 px`.

## Final pass

- Fonts and typography: passed; all menu labels remain 14 px and the long label is a single readable line.
- Spacing and layout rhythm: passed; row height, 9 px icon gap, padding, separators, radius, and shadow remain aligned.
- Colors and visual tokens: passed; neutral menu surface and red destructive action are unchanged.
- Image quality and asset fidelity: passed; the existing Phosphor icon system is preserved with no new image assets.
- Copy and content: passed; no label was shortened or rewritten.
- Interaction and accessibility: passed; menu semantics and keyboard Escape behavior are unchanged, with no overflow or clipping.

## Primary interactions tested

1. Open project action menu — healthy.
2. Verify `在文件管理器中打开` is visible at one line and exactly `34 px` high — passed.
3. Verify no horizontal content overflow — passed.
4. Close the menu with Escape — covered by Electron E2E.

## Follow-up polish

- No actionable P0/P1/P2 differences remain for this menu state.

final result: passed

---

# Conversation Sticky Turn Navigation QA — 2026-08-31

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-c70ca1bd-9a80-46ce-858c-209c6eb6ca0c.png`.
- Browser-rendered implementation: `/Users/17a/projects/rux/qa/conversation-sticky/sticky-turn-navigation-final-2026-08-31.png`.
- Focused comparison: `/Users/17a/projects/rux/qa/conversation-sticky/sticky-turn-navigation-comparison-2026-08-31.png`.
- State: light theme, project conversation with five completed turns, Sticky showing turn 3 with previous and next navigation enabled.

## Normalization

- Source screenshot: `1434 × 164` px at inferred 2× application density.
- Browser implementation: `1440 × 900` CSS px at device scale factor 1.
- Source Sticky crop: `1360 × 76` px, normalized to `680 × 38` px.
- Implementation Sticky crop: `680 × 38` px.
- Focused comparison: `1360 × 38` px with the source on the left and implementation on the right.

## Full-view and focused evidence

- The full browser capture confirms the Sticky remains aligned with the conversation column and does not overlap messages or the composer.
- Focused comparison confirms the original 38 px bar height, label/title hierarchy, border, radius, and shadow are preserved while adding a compact separated navigation group.
- Runtime navigation verified `3 → 2 → 3`, rapid continuous navigation `3 → 1 → 5`, and disabled boundary states at the first and last completed turns.
- Browser console error check: no errors.

## Findings and comparison history

### Iteration 1

- [P1] The existing Sticky exposed only one current-position action and had no way to traverse completed turns.
  - Fix: added accessible previous/next buttons using the existing Phosphor ArrowUp and ArrowDown icons, with automatic disabled states at either end.
- [P1] Initial navigation testing jumped from turn 3 to turn 1 because the active-turn threshold used a 12 px offset while user messages reserve 62 px for Sticky positioning.
  - Fix: aligned the detection threshold to 64 px and temporarily locks the selected navigation target during the smooth-scroll animation, preventing skipped turns during rapid clicks.

## Final pass

- Fonts and typography: passed; the existing 11 px label and 13 px truncated title remain unchanged.
- Spacing and layout rhythm: passed; the bar remains `680 × 38` px and the new navigation group uses two 25 px controls with a subtle divider.
- Colors and visual tokens: passed; neutral text, border, hover, focus, and disabled opacity use existing Rux tokens.
- Image quality and asset fidelity: passed; ArrowUp and ArrowDown are native Phosphor vectors with no new raster assets.
- Copy and content: passed; the current Sticky question remains visible, with native tooltips `上一轮` and `下一轮`.
- Interaction and accessibility: passed; navigation is a labeled group, each direction has an explicit accessible name, disabled states are semantic, and the current-question body remains independently clickable.

## Primary interactions tested

1. Navigate from turn 3 to turn 2 — passed.
2. Navigate forward from turn 2 to turn 3 — passed.
3. Rapidly navigate to the first and last completed turns without skipping — passed.
4. Verify previous is disabled at turn 1 and next is disabled at turn 5 — passed.
5. Click the Sticky title to return to its current question — preserved.

## Follow-up polish

- No actionable P0/P1/P2 differences remain for the Sticky navigation state.

final result: passed

---

# Conversation Output Prototype QA — 2026-09-01

## Comparison target

- Selected concept: option 2, “Inline Footnotes”.
- Source visual truth: `/Users/17a/.codex/generated_images/01a04711-8a0b-7460-bfc3-ced4efe0142d/exec-24180e0e-e6d3-4552-b954-a8ce03692c0a.png`.
- Browser-rendered implementation:
  - `/Users/17a/projects/rux/qa/conversation-output-prototype/implementation-collapsed.png`
  - `/Users/17a/projects/rux/qa/conversation-output-prototype/implementation-expanded.png`
- Side-by-side evidence: `/Users/17a/projects/rux/qa/conversation-output-prototype/comparison-option-2.png`.
- Interaction review video: `/Users/17a/projects/rux/qa/conversation-output-prototype/conversation-output-option-2-review.mp4`.
- Scope: independent development-only review prototype opened with `?prototype=conversation-output`; production Rux conversation rendering is intentionally unchanged pending approval.

## Normalization

- Browser viewport and captures: `1440 × 1024` CSS px.
- Source image: `1487 × 1058` px, normalized proportionally into a `720 × 512` comparison cell.
- Implementation capture: `1440 × 1024` px, normalized proportionally into a `720 × 512` comparison cell.
- Video: `1440 × 1024`, 10 fps, 7.4 seconds, H.264.

## Full-view and focused evidence

- The implementation preserves the selected concept’s broad white reading canvas, compact top bar, black right-aligned user bubble, centered date, processing-time divider, direct assistant prose, and low-noise bottom composer.
- Tool activity is presented as quiet inline footnotes. File reads, commands, and failures remain one-line summaries until clicked; expanded command output uses a subtle left rule and neutral surface instead of a persistent card.
- Failure handling exposes a real retry state and transitions from failure to retrying to recovered, including an explicit “已从失败处继续” confirmation.
- The review video demonstrates streaming text, pause, continue, command expansion/collapse, error expansion, retry, and recovery rather than static mock-only states.

## Findings and fixes

- [P1] Tool evidence could dominate the conversation when rendered as permanent cards.
  - Fix: all tool details are collapsed by default and opened only from their summary row.
- [P1] A failed tool call did not communicate whether work could continue.
  - Fix: added an actionable retry control with retrying, success, and resumed states.
- [P2] Conversation progress was ambiguous during generation.
  - Fix: added streamed text with a caret plus explicit pause/continue controls.
- [P2] Expanded tool details initially used a decorative gradient.
  - Fix: replaced it with a solid neutral `#fafafa` surface to match the restrained Codex-style visual language.

## Primary interactions tested

1. Load prototype with all tool details collapsed — passed.
2. Expand and collapse `运行 pnpm test`; verify command, working directory, and output are revealed only while expanded — passed.
3. Expand the failure row, invoke retry, and verify recovered and resumed states — passed.
4. Pause streaming and verify the control changes to `继续`; resume streaming — passed.
5. Replay the prototype and verify initial collapsed/error state is restored — passed.
6. Browser console warning/error check — no entries.
7. `pnpm typecheck` and `pnpm build:web` — passed.

## Follow-up

- Formal integration into the production conversation renderer should begin only after visual and motion approval of this review prototype.

final result: passed

---

# Project Conversation Running Indicator QA — 2026-09-01

## Comparison target

- Source visual truth: `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-92812105-211b-475e-97b1-1157d78e0fc3.png`.
- Browser-rendered implementation:
  - `/Users/17a/projects/rux/qa/project-thread-running/full-running.jpg`
  - `/Users/17a/projects/rux/qa/project-thread-running/sidebar-running.jpg`
- Focused side-by-side evidence: `/Users/17a/projects/rux/qa/project-thread-running/loading-comparison.png`.
- State: light theme, expanded project, selected project conversation with an active Agent run.

## Normalization

- Browser viewport: `1440 × 900` CSS px with device scale factor `2`.
- Source screenshot: `484 × 792` px; the focused selected-row crop uses `464 × 64` px.
- Browser implementation capture: `1440 × 900` px; the sidebar-focused capture is `300 × 900` px.
- The implementation row crop was normalized to the same `464 × 64` output size before side-by-side inspection.

## Evidence

- The supplied source is itself a sidebar crop, so the complete browser capture is used to verify placement in the live Rux shell while the focused comparison verifies the selected project-conversation row.
- Both source and implementation show a neutral 16 px outline spinner at the trailing edge of the running project conversation, including on the selected gray row.
- The implementation uses the existing Phosphor `CircleNotch` icon and shared `.spin` animation; no custom SVG, CSS drawing, raster substitute, or new visual asset was introduced.
- Browser DOM inspection exposes the running marker as a live status named `{会话标题} 正在响应`.

## Findings and comparison history

- [P1] Project conversations previously had no sidebar-level indication while another thread was running.
  - Fix: exposed `runningThreadIds` from the real Agent-run controller and passed it to the project tree.
  - Post-fix evidence: `qa/project-thread-running/full-running.jpg` and `qa/project-thread-running/loading-comparison.png`.
- [P2] A generic activity marker could incorrectly imply an independent conversation was part of a project run.
  - Fix: the visual marker is intentionally applied only to project child rows; the component test verifies that an independent conversation ID in the same running set is not marked.

## Required fidelity surfaces

- Fonts and typography: passed; existing project-thread typography, truncation, and weight are unchanged.
- Spacing and layout rhythm: passed; the spinner occupies the existing trailing action area without changing the 31 px child-row height or title inset.
- Colors and visual tokens: passed; neutral gray matches the supplied source and existing sidebar icon language.
- Image quality and asset fidelity: passed; the native Phosphor vector remains sharp and animates through the shared spinner keyframes.
- Copy and content: passed; no visible thread labels were changed and the accessibility-only status names the actual thread.
- Interaction and accessibility: passed; the status is tied to live run state, is exposed with `role=status`, and disappears when the run state is cleared.

## Primary interactions tested

1. Start an Agent turn in a project conversation and verify the corresponding project child exposes a running status — passed.
2. Verify the selected row retains its fill and shows the trailing spinner — passed.
3. Verify independent conversations do not render the project-specific indicator — passed by component test.
4. Verify the idle/reset state contains no running marker — passed.
5. Browser console warning/error check — no entries.
6. Full unit suite (`21` files, `75` tests), typecheck, web build, and Electron build — passed.

## Follow-up polish

- [P3] During pointer hover, the existing conversation action button temporarily overlays the spinner so the row menu remains reachable; the spinner returns immediately when hover leaves.

final result: passed

---

# Combined Model, Reasoning, and Speed Menu QA — 2026-09-01

## Comparison target

- Source visual truth:
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-2674eed4-7ee3-43d0-a8e7-c3c2bf428466.png`
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-1afdf76e-85ee-4184-b8b3-83d8338cd3f4.png`
  - `/var/folders/hl/d5hg44c53b958y88jbqlwdw00000gn/T/codex-clipboard-b07ea734-6491-449b-a6d2-bc8a4994bc8e.png`
- Browser-rendered implementation:
  - `/Users/17a/projects/rux/qa/run-settings-menu/model-menu.jpg`
  - `/Users/17a/projects/rux/qa/run-settings-menu/reasoning-menu.jpg`
  - `/Users/17a/projects/rux/qa/run-settings-menu/speed-menu.jpg`
- Combined side-by-side evidence: `/Users/17a/projects/rux/qa/run-settings-menu/comparison.png`.
- State: light theme, existing project conversation, combined run-settings trigger open with model, reasoning, and standard-speed submenus captured separately.

## Normalization

- Desktop browser CSS viewport: `1440 × 900`; in-app browser screenshots were normalized to `1280 × 720` px.
- Source captures: `1098 × 456`, `1034 × 578`, and `1046 × 442` px.
- Each source and implementation state was normalized into a `600 × 420` comparison cell; implementation crops use the live composer/menu region rather than surrounding conversation content.
- Responsive bounds were also measured at `1000 × 700` and `680 × 700` CSS px.

## Full-view and focused evidence

- Complete implementation screenshots verify that the combined trigger remains in the existing Rux composer alongside Agent, Agent mode, voice, and send controls.
- Focused comparisons verify the same two-level structure as the sources: compact left overview, selected gray row, right-side list, trailing chevrons, current-value checkmark, advanced disclosure, and the combined `model + reasoning` trigger label.
- The model submenu uses the live Codex catalog. The speed row appears only when the current model advertises service tiers, preventing unsupported controls for custom, Claude Code, or Pi models.
- Standard and priority speed are real run parameters. `priority` is passed through validated IPC to Codex `thread/start`, `thread/resume`, and `turn/start` as `serviceTier`.

## Findings and comparison history

- [P1] Model and reasoning were previously separate composer buttons and did not match the supplied combined interaction.
  - Fix: replaced them with one rounded trigger and a left overview/right submenu interaction while preserving the separate Agent and Agent-mode controls.
  - Post-fix evidence: all three browser screenshots and `qa/run-settings-menu/comparison.png`.
- [P1] Speed had no end-to-end run parameter and could not be presented honestly.
  - Fix: added model service-tier metadata, per-Agent preference persistence, validated IPC, and Codex app-server `serviceTier` propagation. The menu is conditional on actual catalog support.
- [P2] The first responsive pass placed the right submenu beyond the viewport at widths `1000` and `680`.
  - Fix: the submenu flips to the left below `1100` px and stacks above the root menu below `720` px. Post-fix runtime measurements report `overflow: false` at both breakpoints.
- [P2] The first speed comparison captured `快速` while the source showed `标准`.
  - Fix: restored standard speed, waited for the transient toast to clear, recaptured, and regenerated the final combined comparison.

## Required fidelity surfaces

- Fonts and typography: passed; existing SF/PingFang stack, compact 13 px menu labels, muted values, hierarchy, and single-line truncation match the source language.
- Spacing and layout rhythm: passed; rounded trigger, 38 px rows, 8 px panel padding, 14 px radii, hairline borders, submenu gap, and aligned checkmarks closely match the supplied states.
- Colors and visual tokens: passed; white surfaces, neutral gray hover selection, muted secondary copy, and restrained shadows use existing Rux tokens.
- Image quality and asset fidelity: passed; all chevrons and checkmarks use Phosphor vectors, with no raster substitutes, handcrafted SVGs, CSS drawings, or placeholder assets.
- Copy and content: passed; model names are compacted to the supplied `5.6 Sol` form, reasoning labels use `轻度 / 中 / 高 / 极高 / 最高 / Ultra`, and speed copy matches `标准 / 快速` semantics.
- Interaction and accessibility: passed; menus expose dialog/menu/menuitem/menuitemradio semantics, checked states, Escape/outside close behavior, focus restoration, and an expandable advanced group.

## Primary interactions tested

1. Open the combined run-settings trigger and inspect the default model submenu — passed.
2. Switch to reasoning, select `极高`, and verify the composer trigger updates — passed.
3. Switch to speed, select `快速`, reopen, and verify `aria-checked=true` — passed.
4. Restore `标准` speed and verify the reference-aligned selected state — passed.
5. Collapse and expand the advanced settings group — covered by component behavior.
6. Verify no submenu overflow at `1000 × 700` and `680 × 700` — passed.
7. Browser console warning/error check — no entries.
8. Full unit suite (`21` files, `75` tests), typecheck, web build, and Electron build — passed.

## Follow-up polish

- [P3] The implementation panels are slightly denser than the Retina source after normalization because Rux retains its existing 13 px composer scale and smaller app-level control density.

final result: passed
