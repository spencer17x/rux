# Codex nested model menu QA — 2026-08-20

## Comparison target

- Broken Rux state: `design-audit/codex-model-menu-2026-08-20/00-before-flat-list.png`.
- Source visual truth:
  - `design-audit/codex-model-menu-2026-08-20/10-reference-model-submenu.png`
  - `design-audit/codex-model-menu-2026-08-20/11-reference-reasoning-submenu.png`
  - `design-audit/codex-model-menu-2026-08-20/12-reference-speed-submenu.png`
  - `design-audit/codex-model-menu-2026-08-20/13-reference-primary-menu.png`
- Browser implementation:
  - `design-audit/codex-model-menu-2026-08-20/02-model-submenu.png`
  - `design-audit/codex-model-menu-2026-08-20/03-speed-submenu.png`
  - `design-audit/codex-model-menu-2026-08-20/04-advanced-panel.png`
  - `design-audit/codex-model-menu-2026-08-20/05-reasoning-submenu.png`
- Side-by-side comparison inputs: `20-comparison-model.png`, `21-comparison-reasoning.png`, `22-comparison-speed.png`, and `23-comparison-advanced.png` in the same evidence folder.

## Viewport and normalization

- Reference captures: 2866 × 1624 physical pixels at macOS Retina density, normalized to 1433 × 812.
- Browser implementation: 1433 × 812 CSS pixels, device scale factor 1.
- Comparison images: 2866 × 812, reference on the left and implementation on the right.
- State: light theme, editable Codex task, Composer model control open with each submenu selected.

## Findings

No actionable P0, P1, or P2 findings remain in the scoped Composer model menu.

- Fonts and typography: compact system UI type, semibold category labels, muted selected values, menu item hierarchy and truncation match the reference intent. Reasoning choices use the target Chinese labels without leaking catalog descriptions into the menu.
- Spacing and layout rhythm: the old tall single-column picker is replaced by a 224 px primary menu and right-side submenus. Row height, padding, rounded corners, separators, elevation and Composer anchoring follow the reference geometry without clipping the Composer or persistent controls.
- Colors and tokens: white translucent surfaces, subtle grey borders, neutral hover/active fills, blue range progress and selected checks align with the reference light-theme tokens.
- Image and icon fidelity: no raster assets are present. Existing Lucide chevrons, checks and lightning icon remain optically consistent with the reference controls; the range input is a real interactive control.
- Copy and content: primary rows are exactly `模型`, `推理强度`, `速度`, and `高级`. Model names are normalized from live catalog display names; speed copy is `标准 / 默认速度` and `快速 / 1.5 倍速度，用量更多`.
- Interaction and accessibility: the trigger and primary rows expose menu relationships and expanded state; model, reasoning and speed choices use named radio-menu items; Escape backs out of a submenu before closing the menu; Advanced exposes a labelled discrete slider.
- Runtime fidelity: `model/list` supplies models, supported reasoning efforts, service tiers and the default service tier. A selected non-default speed tier is persisted on the Task/Run and forwarded as `serviceTier` to `thread/start`, `thread/resume`, and `turn/start`.

## Comparison history

1. Initial P1: Rux rendered every model in one tall flat picker, repeated reasoning suffixes on model rows, and omitted the reference primary hierarchy, speed control and advanced state.
2. Fix: implemented the four-row primary menu, right-side model/reasoning/speed submenus, live catalog service tiers, and the Advanced discrete slider.
3. First comparison found a P2 reasoning-menu content drift because English catalog descriptions appeared beneath each Chinese effort label, and a P2 advanced-state drift because the native slider used an unstyled black track.
4. Fix: reasoning rows now match the reference label-only treatment; Advanced uses a discrete blue/grey track, marks and white thumb. Post-fix evidence is recorded in the implementation and comparison images above.

## Runtime checks

- Browser interactions tested: open/close, model submenu, reasoning submenu, speed submenu, Standard/Fast selection, Advanced open/back, Escape behavior.
- Browser console: no errors or warnings.
- Packaged `Rux.app`: loaded the live catalog and exposed `5.6 Sol`, `5.6 Terra`, `5.6 Luna`, `5.5`, `5.4`, `5.4 Mini`, and `5.3-Codex-Spark`; the real speed submenu exposed Standard and Fast.
- `npm test`: passed.
- `npm run build:desktop`: passed.
- `npm run package`: passed; package remains unsigned because no Developer ID identity is configured.

## Follow-up polish

- P3: full-screen task content and Composer horizontal position differ between the supplied reference task and the showcase fixture. Menu geometry and interactions were compared relative to the Composer; dynamic task content was not treated as model-menu drift.

final result: passed
