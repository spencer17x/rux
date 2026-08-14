# P2-E0 Auto Model Routing acceptance

- Date: 2026-08-14
- App: unsigned packaged `/Users/17a/projects/rux/app/release/mac-arm64/Rux.app`
- Platform: macOS arm64
- Viewport: 1358 × 768 logical pixels
- Workspace: isolated Git repository under `/private/tmp/rux-p2-e0-fqe3FN/workspace`
- Provider fixtures: official-shape Fake Codex App Server plus a localhost Responses-compatible server; no real Provider account, history or credential was used

## Evidence

| File | Result |
| --- | --- |
| `00-auto-agent-configuration.jpeg` | Immutable Agent policy shows distinct simple/complex verified models, balanced strategy, allowlist and explicit fallback toggle. |
| `01-auto-simple-token-unreported.jpeg` | Simple request resolves to `fake-fast`; Transcript shows actual model, `Auto · 简单任务`, and truthful `Token 未报告`. |
| `02-auto-simple-run-unreported.jpeg` | Run inspector preserves the deterministic score/reason and explains that missing usage is not billing truth. |
| `03-auto-complex-token-reported.jpeg` | Complex implementation/migration request resolves to `fake-model`; Transcript shows 15 reported tokens. |
| `04-token-breakdown.jpeg` | Run inspector distinguishes input 10, cached input 3, output 5, reasoning 2, total 15, source `Engine 报告`. |
| `05-explicit-allowlist-fallback.jpeg` | After the selected catalog model disappears, the same policy records the bounded `fake-model → fake-fast` fallback and reason. |

## Additional packaged checks

- The same isolated app was restarted with the same user-data directory. Agent Revision, actual model, classification, Token evidence and Run reason remained unchanged.
- A localhost Rux Native Connection successfully verified `native-a` and `native-b`. A simple Auto Run established Native Session `resp-3` on `native-a`; a complex follow-up was rejected before Provider execution because `rux-native` does not declare per-Run model switching. The visible error required keeping `native-a` or creating a new Task with `native-b`.
- Acceptance found and fixed two persistence defects: an empty Workspace Starter rewrote a selected custom Agent back to the built-in Revision, and a pre-start failed Run omitted its custom Profile id. Both fixes were rebuilt and covered by release-boundary/Task Store validation before the final package.

## Acceptance result

P2-AUTO-001 through P2-AUTO-012 pass across schema/unit, Adapter contract, SQLite merge, Desktop/stdio Runtime, Rust TUI and packaged Desktop evidence. Auto never crossed Agent, Engine, Connection or allowlist boundaries; no model-based router or hidden routing usage was introduced.

Known distribution limitation: the macOS bundle remains unsigned and is not ready for public distribution until Developer ID signing and notarization are configured.
