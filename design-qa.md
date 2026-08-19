# Design QA — Rux v1 Codex-only reset

> Historical QA record. Its fixed Codex Desktop anchors are superseded for new v1 work by the current-client parity contract in `docs/product-requirements.md` and versioned same-state reference evidence.

## Evidence

- Source visual truth: `design-audit/final-local-goals/00-codex-26.810.52044-reference.png`.
- Normalized source: `design-audit/codex-v1-reset/00-reference-1433x812.png`.
- Browser implementation: `design-audit/codex-v1-reset/01-showcase-1433x812.png`.
- Full-view comparison: `design-audit/codex-v1-reset/02-side-by-side-1433x812.png`.
- Packaged Codex account surface: `design-audit/codex-v1-reset/03-packaged-codex-account.png`.
- Packaged main surface: `design-audit/codex-v1-reset/04-packaged-main.png`.
- Existing focused project-rail evidence remains under `design-audit/project-rail-codex-alignment/`.

## Viewport and normalization

- Source: 2866 × 1624 physical pixels at 2× density, normalized to 1433 × 812.
- Browser implementation: 1433 × 812 CSS and physical pixels at deviceScaleFactor 1.
- State: Codex reference shows a permission-waiting Task; Rux implementation shows the accepted completed showcase Task with Environment open. These are different lifecycle states, so transcript copy and approval content are not treated as geometry mismatches.
- The side-by-side artifact compares both complete frames in one image. Focused rail comparisons were already passed at the same normalized viewport.

## Findings

- No actionable P0, P1, or P2 mismatch remains for the v1 reset.
- The 240 px sidebar, 46 px top bar, centered 736 px transcript/Composer rail, 99 px Composer and right-floating Environment surface retain the accepted Codex Desktop anchors.
- Removing `Agents`, generic Agent import, Board, Working Copies and Improvement Center is an intentional product-content change required by the v1 Codex-only brief. It reduces the sidebar while preserving its density, spacing and hierarchy.
- The Composer now shows a fixed `Codex` identity in the same control slot; approval, model, voice and send controls retain their positions.
- The packaged account row now opens one Codex/ChatGPT surface directly. No multi-Agent detection or Provider builder is visible.

## Required fidelity surfaces

- Fonts and typography: the existing system/SF/Inter stack, 13–14 px navigation text, compact metadata, single-line truncation and transcript hierarchy remain aligned. Native rasterization differences are acceptable.
- Spacing and layout rhythm: major tracks, insets, row heights, radii, thin dividers and overlay placement match the accepted reference anchors.
- Colors and tokens: pale flat sidebar, white task surface, soft neutral selection, low-contrast borders and restrained shadows remain aligned.
- Image and icon fidelity: the UI contains no required raster imagery. Existing library icons are used consistently; no placeholder or handcrafted icon art was introduced.
- Copy and content: visible product name is `Rux`; execution identity is `Codex`; removed multi-Agent concepts do not leak into the normal sidebar, Composer, account page or settings page.

## Interaction verification

- Browser preview:
  - `新对话` creates a blank Task directly and focuses `给 Agent 发送消息`.
  - `账户与登录` opens the Codex-only account surface.
  - `Rux 设置` exposes permissions, Codex model/reasoning, local data, updates and Git placeholder without Board or improvement controls.
  - Console warning/error list was empty.
- Packaged Electron app:
  - Launched `app/release/mac-arm64/Rux.app`.
  - Accessibility tree exposed only `新对话`, `变更`, `环境`, `已安排` in primary navigation.
  - Composer exposed `执行引擎：Codex` with no Agent menu.
  - Account row opened the Codex/ChatGPT login surface directly and showed the real connected Codex CLI status without exposing credentials.
- Automated verification:
  - Full `npm test` passed.
  - `npm run build:desktop` passed.
  - `npm run package` passed; package remains unsigned.

## Comparison history

1. Initial implementation still exposed Agents, Improvement Center, Board/Working Copy entries, generic session import, Agent switching and a multi-Provider account dialog.
2. First reset removed those navigation entries, fixed the Composer identity to Codex, forced new Tasks to the built-in Codex choice and removed the pre-Run multi-Agent detection gate.
3. Packaged click verification found the footer account row still opened an old `管理 Agent 与 Provider` popover.
4. The footer was changed to open the Codex-only account surface directly; settings were reduced to Codex v1 concepts; browser and packaged click paths then passed.

## Follow-up polish

- P3: exact private Codex glyphs and macOS font rasterization vary slightly because Rux uses its existing public icon library and Electron rendering.
- P3: the completed showcase contains more project rows than the permission reference; normal startup remains user-owned and does not preload those fixtures.

final result: passed
