# Rux main/Environment comparison — 2026-08-22

## Audit scope

- Surface: official ChatGPT macOS Codex `26.818.32112` main workspace versus the actual packaged Rux app.
- User goal: align the visible shell, task content rail, Composer rail, account footer, task-header controls, and Environment card without inventing uncaptured behavior.
- Mode: combined visual and accessibility audit.
- Target screenshot: `02-main-environment.png` (`2880 × 1624` physical pixels).
- Rux screenshots: `../codex-goal-2026-08-22/52-packaged-environment-before-26.818-geometry.jpeg` and `../codex-goal-2026-08-22/53-packaged-environment-after-26.818-geometry.jpeg` (`1356 × 768`, Computer Use capture).

The image sizes use different capture scales, so comparisons below use proportions and stable edges rather than claiming an unverified target CSS scale.

## Steps and health

1. **Target main workspace — healthy baseline.** The supplied image is stable and exposes the sidebar, task header, content rail, Composer region, and complete Environment card. It also proves a Share control appears immediately before `打开位置`.
2. **Packaged Rux before correction — needs alignment.** The sidebar and content rail were proportionally narrower, the account footer was taller, and the Environment card extended materially lower than the target.
3. **Packaged Rux after correction — healthy for measured geometry.** The sidebar, content/Composer rail, footer boundary, and Environment top/right/bottom edges now align proportionally with the target. The packaged accessibility tree preserves the expected heading and control order.

## Findings

### Strengths

- Both products use the same overall hierarchy: fixed sidebar, single task surface, bottom Composer, top-right task tools, and a floating right Environment card.
- Rux already matched the Environment width, top offset, right inset, border radius, and row order closely.
- The Rux Environment controls expose descriptive accessible names for Changes, Local, branch, Commit or push, Compare branches, and Sources.

### Corrected differences

- Sidebar width moved from `228px` to `241px`.
- Main transcript/Composer rail moved from `698px` to `736px`.
- Sidebar account footer moved from 54px total height to 46px.
- Environment card height moved from `459px` to `397px`.
- The missing task-header Share entry was added before `打开位置` with an explicit evidence gate.

### Remaining UX and accessibility risks

- The screenshots do not establish Share behavior, audience selection, link permissions, revoke behavior, or error recovery. The Rux control is therefore visible but disabled with an accessible reason.
- The target and Rux screenshots do not contain identical transcript content, attachment count, account identity, or source rows. This is a geometry comparison, not a full same-state visual proof.
- Screenshot evidence cannot prove keyboard order, focus visibility, contrast, zoom/reflow, or screen-reader state changes; these remain separate acceptance work.
- The target logical viewport and display scale remain unverified despite the close proportional match.

## Verdict

The measured shell geometry is materially closer to `26.818.32112` and no content clipping is visible in the accepted after capture. Full parity remains unproven until the same transcript/account/source state and exact logical viewport can be reproduced, and until the Share click path is captured.
