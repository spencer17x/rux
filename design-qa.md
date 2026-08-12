# Rux settings reference — Design QA

## Evidence and normalization

- Source visual truth: `/Users/17a/projects/rux/design-audit/settings-reference-2026-08-11/01-source.png`.
- Packaged implementation: `/Users/17a/projects/rux/design-audit/settings-reference-2026-08-11/02-packaged-rux-settings.png`.
- Final side-by-side comparison: `/Users/17a/projects/rux/design-audit/settings-reference-2026-08-11/03-comparison-final.png`.
- Source dimensions: `2866 × 1624` physical pixels at `@2x`, equivalent to a `1433 × 812` CSS viewport.
- Implementation dimensions: `1356 × 768` physical pixels at native packaged-window density, equivalent to a `1356 × 768` CSS viewport.
- Density normalization: the source was resized to `1356 × 768` and placed beside the native `1356 × 768` packaged screenshot. The aspect-ratio difference is below 0.1% and no content crop was required.
- State: macOS light theme; Rux settings opened from the account menu; no login, project import, Agent run, or permission change was performed.

## Full-view comparison evidence

The final comparison confirms the reference anatomy: a 240 px pale grey settings rail, native macOS window controls, a labelled return action, all-settings row, pill search field, compact grouped navigation, a white scrolling settings canvas, a centered 768 px content rail, a 22 px page title, section headings, and bordered 16 px-radius grouped rows. The title, card left edge, card width, first section baseline, and section-to-section rhythm align with the normalized reference.

The main content intentionally differs from the reference where product truth requires it. Rux exposes three mutually exclusive permission modes instead of three independent switches, so the rows use the reference switch language while preserving radio semantics. The General card contains the real Rux login, model catalog, reasoning effort, and refresh behaviors instead of unsupported file-opener, language, dock, or terminal preferences. The sidebar omits the reference's Pet entry and keeps unsupported Git visibly disabled.

Focused-region artifacts were not necessary: the permission switches, sidebar navigation, search field, selects, copy, borders, and login callout are all readable at original resolution in the combined full-view image. The implementation screenshot was also inspected directly at native size.

## Required fidelity surfaces

### Fonts and typography

Passed. The packaged app uses the native macOS system stack with matching optical hierarchy: 22 px page title, 14 px section titles, 12 px row labels, and restrained 10.5 px descriptions. Weights, wrapping, line height, and muted secondary text remain consistent with the source.

### Spacing and layout rhythm

Passed. The 240 px rail, centered 768 px content column, 66 px top inset, 35 px title gap, 50 px section gap, 72 px permission rows, 16 px card radius, and low-contrast separators reproduce the reference's structure without overflow at `1356 × 768`.

### Colors and visual tokens

Passed. The implementation uses a cool pale-grey rail, white canvas, low-contrast `#e2e3e5` card borders, dark neutral text, muted descriptions, and blue selected switches. The active navigation row and hover/focus states remain restrained and consistent with the source.

### Image quality and asset fidelity

Passed. The settings reference contains no photography, illustration, logo, or custom raster artwork. Rux uses the existing Lucide icon system for interface icons, rendered sharply at native density. No emoji, placeholder asset, handcrafted SVG, or decorative raster substitution was introduced.

### Copy and content

Passed with intentional product-specific deviations. Visible branding is Rux. Enabled rows describe real Rux behavior, the account action is truthful, the settings auto-save statement matches implementation, and no invitation or Pet control is present. Internal provider/model identifiers remain unchanged at the protocol boundary.

## Interaction acceptance

- Opened the packaged `Rux.app`, opened the account menu, and selected `Rux 设置`.
- Confirmed the accessibility tree exposes `设置导航`, `返回 Rux`, `搜索设置`, permission radio states, model/reasoning selects, refresh-model action, and account action.
- Entered `模型` in settings search and verified the permission section is removed while the matching General/model section remains.
- Cleared the search and verified the full settings page returns.
- Activated `返回应用` and verified the task workbench becomes visible again.
- No account login, project import, Agent request, model refresh, or permission mutation was triggered during QA.
- No renderer crash, broken control, inaccessible persistent action, or visible error state was observed.

## Comparison history

### Pass 1 — full-screen settings surface

- Replaced the compact modal with the reference's full-height two-pane composition.
- Connected the sidebar search, return action, account route, Agent anchor, permission radios, model/reasoning controls, and model refresh.
- Preserved real permission semantics and automatic persistence rather than adding display-only toggles.

### Pass 2 — focus-state correction

- Earlier finding: `[P2]` the search input was automatically focused on open, creating a blue focus ring absent from the reference and making the sidebar visually louder.
- Fix: removed automatic search focus while preserving normal keyboard focus and focus-visible behavior.
- Post-fix evidence: `03-comparison-final.png` shows the neutral pill search field and the source-matched first-open state. Packaged interaction recheck passed.

## Findings

No actionable P0, P1, or P2 visual or interaction findings remain. The reduced navigation catalog and Rux-specific General rows are intentional truthfulness constraints, not visual regressions.

## Verification

- `npm test`: passed, including typecheck, authentication, persistence, Agents, adapters, permissions, Context, Runtime lifecycle/host, Git, Sites, and TUI suites.
- `npm run build:web`: passed with the existing non-blocking large-chunk warning.
- `npm run package`: passed and rebuilt `/Users/17a/projects/rux/app/release/mac-arm64/Rux.app`.
- Non-blocking note: the macOS package remains unsigned because no Developer ID certificate is configured.

final result: passed
