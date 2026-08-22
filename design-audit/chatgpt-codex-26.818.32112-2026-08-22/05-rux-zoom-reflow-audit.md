# Rux packaged zoom/reflow audit — 2026-08-22

## Audit scope

- Surface: actual packaged `Rux.app`, main Task workspace.
- Flow: actual size → intermediate zoom → high zoom/reflow failure → corrected high zoom.
- Accessibility target: preserve information and operation without horizontal clipping when the effective viewport becomes narrow under browser zoom.
- Capture tool: Computer Use against `app/release/mac-arm64/Rux.app`.
- Evidence folder: `design-audit/codex-goal-2026-08-22/`.

The exact Electron zoom percentage is not exposed in the accessibility tree. The fifth zoom-in step produces an effective viewport of roughly 339 × 192 CSS pixels on this window and is treated as the high-zoom/reflow stress state, not as proof of an exact target-client percentage.

## Steps and health

1. **Actual size — healthy.** `55-packaged-zoom-100.jpeg` shows the stable desktop layout with sidebar, Task header, Transcript and Composer.
2. **Intermediate zoom — healthy.** `56-packaged-zoom-step-3.jpeg` keeps the sidebar, header actions, readable Transcript and complete Composer without horizontal clipping.
3. **High zoom before correction — failed.** `57a-packaged-zoom-step-5-before.jpeg` collapses the recovery title into single-character lines, clips its actions, overflows Composer controls and leaves most of the window unusable.
4. **High zoom after correction — healthy for the tested state.** `66-packaged-zoom-step-5-final.jpeg` uses a full-width main surface, mobile sidebar entry, compact header actions, wrapped Changes card layout and a single-row compact Composer. The Transcript remains a separately named and keyboard-focusable scroll region.

## Corrected issues

- Final narrow rules now follow every desktop parity override, so older fixed widths cannot win the cascade.
- Recovery cards switch to a two-column content layout with actions on their own row and anywhere wrapping for long errors.
- Composer input and toolbar compact at the narrowest breakpoint; connection/model text collapses visually while accessible names remain complete.
- Repeated Terminal access is removed from the extreme-width header but remains available through Quick tools and the keyboard shortcut.
- Changes summary/actions reflow from three desktop columns to content plus a separate action row.
- The jump-to-latest control moves to a compact top-right position instead of covering Transcript content.
- Header and Composer right-side safety insets keep the retained actions within the viewport.

## Evidence limits

- Screenshots prove visible reflow only for this macOS window and Electron zoom sequence.
- They do not prove target-client zoom behavior, every possible Task state, VoiceOver announcements, contrast ratios, OS text-size overrides, or orientation changes.
- The tested window is shorter than the common WCAG 400% reference viewport, so the Transcript area is necessarily compact but remains scrollable and operable.
- Complete accessibility parity remains unproven until equivalent target-client and assistive-technology evidence is captured.

## Verdict

The previously failing high-zoom layout is materially corrected and usable in the tested package. This closes a concrete Rux reflow defect but does not establish full WCAG or target-equivalent accessibility compliance.
