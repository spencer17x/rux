# Final local-goals visual audit

- Date: 2026-08-17
- Reference: ChatGPT Codex `26.810.52044`, user-provided 2866 × 1624 Retina screenshot (1433 × 812 logical).
- Rux build: protocol v17, unsigned macOS arm64 QA package.
- Exact comparison viewport: 1433 × 812.
- Actual desktop capture: 1356 × 768 because the current Mac work area clamps the 1433 × 812 BrowserWindow.

## Accepted evidence

1. `00-codex-26.810.52044-reference.png` — supplied reference, permission-waiting state.
2. `01-rux-permission-current.png` — real packaged Rux.app, permission-waiting state. Confirms labelled controls, approval card, disabled composer controls and desktop layering; rejected for pixel comparison only because the OS constrained the window.
3. `04-rux-showcase-overlay-fixed-1433x812.png` — exact-size Renderer after fixing Inspector-induced rail shrink. Confirms the 300 px environment card overlays the centered rail instead of changing it.
4. `05-rux-showcase-no-inspector-1433x812.png` — exact-size stable completed state. Confirms 240 px sidebar, 46 px header, 736 px centered transcript/composer rail, 99 px Composer and 16 px bottom inset.
5. `06-side-by-side-comparison.png` — reference and exact-size Rux capture in one comparison frame.
6. `07-final-packaged-permission.png` — rebuilt final package after the overlay fix; confirms the real permission card, compact Project/Board/WorkingCopy navigation and bottom Composer remain stable.

## Audit steps

1. **Permission-waiting desktop path — healthy.** Opened the persisted `ping` Task in the packaged app. Approval scope, reject/allow actions, waiting status, selected Agent/model and disabled controls were present with accessibility names. The current task contains historical workspace changes below the approval card; this is real state, not a loading fixture.
2. **Exact-size baseline — issue found and fixed.** At 1433 × 812, opening Environment reduced Task Workspace width and shifted the 736 px transcript rail left. The final CSS keeps Task Workspace/Header at 100%; Environment now floats at the right as required.
3. **No-Inspector comparison — healthy.** Sidebar, header, centered content rail and bottom Composer align to the accepted Codex anchors. Added Rux functions (`改进中心`, `看板`, `工作副本`) preserve the same compact navigation rhythm rather than copying unsupported Codex content.
4. **Final package and Worktree entry — healthy.** Rebuilt and relaunched `release/mac-arm64/Rux.app`; the accessibility tree exposes `改进中心`, `看板`, `工作副本`, `新建 Worktree`, approval decisions and Composer controls with visible labels. Opening Working Copies remained metadata-only and did not mutate Git.

## Remaining visual differences

- Transcript content differs by design because the reference shows a permission request and the exact-size Web fixture shows a completed Task. The separate real packaged screenshot verifies the permission state.
- Native macOS controls, font rasterization and screenshot scale differ between the Retina reference and the in-app browser capture; these are not treated as layout failures.
- Screenshots alone do not prove full keyboard order, screen-reader announcements, contrast ratios or zoom/reflow. Automated source-boundary tests and the packaged accessibility tree verify names and disabled states, but not full WCAG compliance.
