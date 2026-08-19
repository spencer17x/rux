# Codex parity QA — 2026-08-19

## Comparison target

- Source visual truth:
  - `design-audit/codex-parity-fixes-2026-08-19/07-reference-account-composer.png`
  - `design-audit/codex-parity-fixes-2026-08-19/08-reference-terminal.png`
  - User-reported failure captures `01-broken-account-layout.png`, `02-model-menu-single-option.png`, and `03-terminal-panel-interaction.png`.
- Rendered implementation:
  - `design-audit/codex-parity-fixes-2026-08-19/09-model-menu-open.png`
  - `design-audit/codex-parity-fixes-2026-08-19/13-image-preview-fixed.png`
  - `design-audit/codex-parity-fixes-2026-08-19/14-packaged-model-switched.png`
  - `design-audit/codex-parity-fixes-2026-08-19/15-packaged-environment-after-terminal.png`
- Combined comparison evidence:
  - `design-audit/codex-parity-fixes-2026-08-19/10-comparison-account.png`
  - `design-audit/codex-parity-fixes-2026-08-19/11-comparison-composer.png`
  - `design-audit/codex-parity-fixes-2026-08-19/12-comparison-terminal.png`

## Normalization and state

- Reference captures: 2866 × 1624 px at macOS Retina density, normalized to 1433 × 812 px.
- Browser implementation: 1433 × 812 CSS px, device scale factor 1.
- Combined comparison images: 2866 × 812 px, reference on the left and implementation on the right.
- Packaged implementation: actual `app/release/mac-arm64/Rux.app`, desktop light theme, current signed-in Codex connection and authorized Rux workspace.
- Compared states: account popover, composer with pasted image, expanded model catalog, bottom terminal with multiple tabs, and right environment panel after leaving the terminal.

## Findings

No actionable P0, P1, or P2 visual or interaction findings remain in the four requested flows.

- Fonts and typography: the implementation keeps the macOS system UI stack, weight hierarchy, compact labels, and truncation behavior of the reference. Dynamic task content differs, but control typography and density remain consistent.
- Spacing and layout rhythm: the account popover is constrained to the sidebar instead of covering the full lower-left region; composer, inspector, and terminal preserve their major-region proportions without overlap at 1433 × 812.
- Colors and visual tokens: light surfaces, subtle borders, muted secondary copy, semantic green/red change counts, orange full-access state, and blue selected menu state align with the reference token intent.
- Image quality and asset fidelity: pasted raster images render at native aspect ratio in a bounded thumbnail with no broken-image state after the final fix. Product icons remain from the existing Lucide family; no target imagery was replaced by placeholder CSS art.
- Copy and content: visible controls use current Codex terminology (`选择模型`, `完全访问`, `环境信息`, `终端`, `变更`, `本地`, `比较分支`) with only the required Rux product branding substitution.
- Accessibility and interaction: the model menu is a labelled listbox, pasted images expose named remove buttons, terminal tabs expose named close controls, and inactive inspector state is `aria-hidden`/`inert`. The packaged app exposed all tested controls in the macOS accessibility tree.
- Responsive/viewport resilience: no overlap, clipping, or hidden persistent controls was observed at the target desktop viewport. Focused region comparisons were required for the composer/model control, account popover, and terminal header because these controls are too small to judge reliably from the full view alone.

## Comparison history

1. Initial user evidence showed a P1 account-popover layout failure, a P0 single-option/non-switchable model control, a P0 missing pasted-image flow, and a P1 terminal/right-panel interaction mismatch.
2. The account popover was bounded; the composer was connected to the real Codex model catalog; pasted image data was routed through Main and Codex `localImage`; and terminal/right inspector transitions were made mutually exclusive. Browser evidence was captured in `04-model-switch-and-image-paste.png`, `05-terminal-tabs-and-panel-mutual-exclusion.png`, and `06-account-menu-layout.png`.
3. First post-fix comparison found a P2 broken thumbnail in Web fallback and a P1 terminal update loop caused by an unstable callback. Web preview storage was changed to a stable data URL and TerminalView now uses a callback ref. Post-fix evidence is `09-model-menu-open.png` and `13-image-preview-fixed.png`.
4. The packaged app loaded the real catalog (`5.6-Sol`, `5.6-Terra`, `5.6-Luna`, `5.5`, `5.2`), switched visibly to `5.6-Terra 中`, created a second `zsh` terminal tab, and removed the bottom terminal when the right environment panel opened. Evidence is `14-packaged-model-switched.png` and `15-packaged-environment-after-terminal.png`.

## Runtime checks

- Primary browser interactions tested: model menu open/select, image clipboard paste/remove, terminal open, new terminal tab, environment-panel transition, and account popover.
- Fresh browser tab console after the final terminal interaction: no errors or warnings.
- `npm test`: passed.
- `npm run build:desktop`: passed.
- `npm run package`: passed; package remains unsigned because no Developer ID identity is configured.
- `git diff --check`: passed.

## Follow-up polish

- P3: dynamic task content and sidebar population cannot be pixel-identical to the reference capture; this is expected state/data variance, not a control or layout mismatch.

final result: passed
