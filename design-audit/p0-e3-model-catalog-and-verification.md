# P0-E3 Model Catalog And Verification Acceptance

Date: 2026-08-12  
Target: packaged macOS arm64 app at 1433 × 812 logical desktop size

## Evidence

- `p0-e3-model-catalog-settings.png`: Rux settings exposes the official Engine catalog source, the last successful refresh time, an editable advanced model ID field, and only catalog-declared reasoning options.
- `p0-e3-manual-model-composer.png`: the Composer keeps the normal model selector compact and places the advanced model ID plus source/verification status in the disclosed run settings.

## Acceptance

- Official Codex App Server `model/list` remains the catalog source and pagination is bounded.
- Engine default, official catalog, verified history, manual-unverified, and unavailable states are deterministic.
- Successful Run verification is isolated by Engine and non-secret Provider Connection reference.
- Authentication, quota, network, and transient failures do not invalidate a model.
- A catalog model that disappears produces a warning and is never silently replaced.
- No OAuth action, credential read, or real Run was performed for this visual verification.
