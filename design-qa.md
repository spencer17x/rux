# Design QA — Current ChatGPT Codex screenshot parity

final result: passed

## Comparison target

- Source visual truth: `/Users/17a/projects/rux/design-audit/chatgpt-codex-current-2026-08-19/01-main-environment.png` through `05-terminal-dock.png`.
- Source pixels: 2866 × 1624 (`@2x` capture).
- Source normalized copies: 1356 × 768 for the available QA display.
- CSS target: 1433 × 812; implementation packaged capture: 1356 × 768 with equivalent aspect ratio.
- Browser implementation viewport: 1356 × 768.
- Packaged implementation: `/Users/17a/projects/rux/app/release/mac-arm64/Rux.app`.

## Accepted implementation evidence

- Main + Environment, browser same-content state: `design-audit/chatgpt-codex-current-2026-08-19/27-browser-main-environment.png`.
- Account menu: `design-audit/chatgpt-codex-current-2026-08-19/24-browser-account-menu.png`.
- Settings: `design-audit/chatgpt-codex-current-2026-08-19/28-browser-settings-final.png` and packaged `21-final-settings.png`.
- Quick tools: `design-audit/chatgpt-codex-current-2026-08-19/26-browser-quick-tools-no-inspector.png`.
- Terminal: packaged `design-audit/chatgpt-codex-current-2026-08-19/23-final-terminal-light.png`.

The browser showcase was used only to reproduce comparable dynamic transcript/account/menu content. Packaged-app captures verify the native Settings, Environment and PTY Terminal surfaces.

## Primary interactions tested

- Open/close account menu; use the Settings entry.
- Open Settings and inspect the complete sidebar taxonomy and General controls.
- Open/close quick-tools menu.
- Open/close Environment panel.
- Open/close the real packaged PTY Terminal.
- Composer permission and model controls remained keyboard-labelled.
- Browser console: no errors or warnings.

## Required fidelity surfaces

- **Fonts and typography:** system sans and monospace hierarchy match the reference closely. Headings, navigation, transcript, menus and settings use the same optical scale; dynamic content wrapping differences are accepted.
- **Spacing and layout rhythm:** 240 px rail, 46 px top bar, centered ~736 px transcript/Composer rail, 300 px floating Environment panel and ~298 px bottom Terminal match the normalized source. Settings content was narrowed to 728 px and section spacing tightened after comparison.
- **Colors and tokens:** pale neutral sidebar, white canvas, blue settings switches, orange Full Access state, green/red Git stats and low-elevation overlays match the source. Terminal was changed from dark to the reference light theme.
- **Image quality and assets:** no source raster artwork is required. Supplied screenshot thumbnails remain real image attachments. UI icons use the repository's consistent Lucide family; no handcrafted SVG/CSS-art substitutions were added.
- **Copy and content:** navigation, account menu, settings taxonomy, quick tools, model label, permission wording, Environment labels and Terminal controls match the supplied Chinese reference. `Rux` replaces the `Codex`/`ChatGPT` product brand intentionally.
- **Accessibility:** visible controls have accessible names; account/quick menus expose menu semantics; settings switches expose checkbox state; Terminal input is reachable. Full VoiceOver and 200% zoom remain separate verification work.

## Comparison history

### Iteration 1 — blocked

- [P1] Terminal covered the Composer instead of reserving space above the bottom panel.
- [P1] Terminal used a dark theme while the supplied Codex reference used a light PTY surface.
- [P2] Settings content was too wide and the permission/general section rhythm was too loose.
- [P2] Account menu, settings taxonomy and quick-tools menu were missing or used the older Rux structure.

Fixes: reserved 298 px for Terminal, switched xterm to a light token set, narrowed Settings to 728 px, tightened vertical rhythm, restored the full reference taxonomy, added anchored account and quick-tools menus, and aligned Environment/source composition.

### Iteration 2 — passed

Post-fix evidence: `23-final-terminal-light.png`, `24-browser-account-menu.png`, `26-browser-quick-tools-no-inspector.png`, `27-browser-main-environment.png`, and `28-browser-settings-final.png`.

No actionable P0/P1/P2 visual differences remain for the five supplied states.

## Follow-up polish

- [P3] Some icon glyphs differ subtly from OpenAI's private icon set while retaining the same meaning, size and stroke family.
- [P3] Packaged isolated QA is signed out and uses an empty local Task, so account name and transcript content differ from the user's live reference; same-content browser captures cover geometry.
- Destination flows behind Pull Requests, Sites, Scheduled and Plugins require their own screenshots and functional parity passes; this report validates the supplied visible states, not every downstream feature.
