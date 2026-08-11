# Codex reference audit — 2026-08-11

The supplied `2866 × 1624` screenshot is treated as an `@2x` source with a `1433 × 812` logical viewport.

Primary evidence:

- `30-web-showcase-final-account.jpg`: final explicit visual fixture, including the completed transcript, Environment card, and generic account popover.
- `31-comparison-reference-showcase-final-account.jpg`: supplied reference and final implementation in one normalized, same-state comparison image.
- `32-packaged-clean-final-controls.jpg`: rebuilt Electron application launched with a fresh temporary user-data directory, no imported project, and no account action.
- `33-web-clean-final-controls.jpg`: final normal Web startup with the same unimported placeholder boundary.
- `20-web-handoff-final.png` and `21-comparison-reference-web-handoff-final.png`: earlier exact-logical-viewport evidence retained for the accepted geometry anchors.

Earlier numbered captures retain the implementation history. `01–06` establish the first visual and geometry passes; `07–10` record interaction and clean-state corrections; `12–21` record packaged-app validation and exact-viewport handoff; `22–27` establish the user-owned-data boundary and deterministic showcase; `28–33` close the remaining visible interactions and final packaged clean-start acceptance.

The final packaged QA used a new temporary Electron user-data directory and only the generated `welcome-workspace` placeholder. It did not open the project picker or account surface and performed no OAuth flow, real provider run, restore, commit, push, or external source transmission. Git mutation verification used test-owned temporary repositories and local bare remotes only; the repository and developer credentials were not used as QA data.
