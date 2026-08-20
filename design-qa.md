# Account menu parity QA — 2026-08-20

## Comparison target

- Source visual truth: `design-audit/account-menu-fix-2026-08-20/02-reference-account-menu.png`.
- User-reported broken state: `design-audit/account-menu-fix-2026-08-20/01-user-reported-broken.png`.
- Browser-rendered implementation: `design-audit/account-menu-fix-2026-08-20/03-browser-account-menu-fixed.png`.
- Side-by-side comparison input: `design-audit/account-menu-fix-2026-08-20/05-side-by-side-account-menu.png`.

## Viewport and normalization

- Reference: 2866 × 1624 physical pixels at macOS Retina density, normalized to 1433 × 812.
- Implementation: 1433 × 812 CSS pixels, device scale factor 1.
- Comparison input: 2866 × 812, reference on the left and implementation on the right.
- State: light theme, expanded account menu, expanded sidebar, right Environment panel open.

## Findings

No actionable P0, P1, or P2 findings remain in the account footer and account-menu flow.

- Fonts and typography: system UI family, compact 13 px menu labels, profile emphasis, muted status copy, and keyboard shortcut treatment preserve the reference hierarchy without wrapping or truncation.
- Spacing and layout rhythm: the menu is 224 px wide, begins at x = 9 px, ends at y = 768 px, and uses natural content height, so neither the profile row nor logout row is clipped after removing the Pets row.
- Colors and visual tokens: white translucent surface, grey border, subtle elevation, muted icons/status and neutral footer background align with the reference treatment.
- Image and icon fidelity: the flow contains no raster imagery. Existing Lucide icons remain consistent in size, stroke and alignment; the initials avatar is a native UI element rather than a substituted image asset.
- Copy and content: the former `账户与登录` pseudo-identity and fabricated `剩余 29%` were removed. Connected state now truthfully shows `ChatGPT` and `已连接`; signed-out state shows `登录 ChatGPT` and `未登录`. A personal display name is intentionally not invented or extracted from credentials.
- Accessibility and interaction: the trigger exposes expanded state; the popover is a named menu; profile, usage, invite, settings and logout are separate named menu items. Profile opens the account dialog and Settings opens the settings surface. The removed Pets feature is absent from both this menu and Settings.
- Responsive resilience: the menu uses natural content height with a bounded viewport maximum; compact rows fit the target viewport without forced overflow, while shorter viewports retain scrolling.

## Comparison history

1. Initial P1: later 35 px row sizing was forced into an older fixed 189 px menu, overflowing both ends and visually clipping the account identity and logout rows.
2. Initial P1: the footer/profile used `账户与登录` as if it were a user identity, while Usage displayed a hard-coded `剩余 29%` copied from reference evidence.
3. Fix: restored the reference compact row geometry, natural menu height, x = 9 px / bottom = 44 px / width = 224 px anchoring, and truthful connection-state labels.
4. Post-fix evidence: `03-browser-account-menu-fixed.png` and `05-side-by-side-account-menu.png`. No remaining P0/P1/P2 mismatch was observed in the scoped account surface.

## Runtime checks

- Browser interactions: account menu open/close, profile → account dialog, account dialog close, and Settings navigation.
- Browser console after interactions: no errors or warnings.
- Packaged `Rux.app`: the prior account-menu build launched successfully; this follow-up removes the Pets row and is covered by the renderer boundary assertion and rebuilt desktop package.
- `npm test`: passed.
- `npm run build:desktop`: passed.
- `npm run package`: passed; package remains unsigned because no Developer ID identity is configured.

## Follow-up polish

- P3: the reference ChatGPT client can display its host-account profile name (`SuperZ`). Rux intentionally shows the verified provider identity (`ChatGPT`) because repository credential-safety rules prohibit scraping credentials or exposing unapproved account payloads in the Renderer.

final result: passed
