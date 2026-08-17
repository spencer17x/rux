# Local success metrics desktop acceptance

Date: 2026-08-17

- Ran the full automated test suite, including the pure local-metrics tests and the no-transport release boundary.
- Built an isolated unsigned macOS package in `app/release-metrics/mac-arm64/Rux.app` because the normal release path was in use by the user's running app.
- Launched an isolated app copy with a separate bundle id and user-data directory.
- Opened Rux Settings with `⌘,` and scrolled to `本机成功指标`.
- Verified the empty-data state uses `未报告` rather than inventing a rate or duration.
- Verified the visible privacy statement says the values are computed locally and that no telemetry/upload channel exists.
- Closed only the isolated QA window; the user's running Rux app was not touched.

Evidence: `settings-local-success-metrics.png`.
