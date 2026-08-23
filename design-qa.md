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
