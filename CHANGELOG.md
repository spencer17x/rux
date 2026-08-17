# Changelog

All notable Rux changes are recorded here. Public releases use semantic versions and must include migration, known-limit, and recovery notes.

## 0.1.0 - Unreleased

### Added

- Codex, Claude Code, and Rux Native coding-agent Runs with workspace, permission, Changes, Context, Session, Agent Revision, model and token evidence.
- Explicit external Session import/refresh/versioning, Context Handoff, local-data lifecycle, and local-only success metrics.
- OpenAI Responses, OpenAI Chat Completions and Anthropic Messages Rux Native Connections with OS-encrypted secrets, explicit diagnostics, and confirmed credential rewrapping.
- Shared protocol v16 desktop/stdio/TUI boundary, confirmation-gated TUI Session/Handoff/local-data/Git parity, and cross-platform installer targets.
- Explicit signed application updates with staged rollout eligibility, native install confirmation, health checkpoints and exact-version signed rollback.

### Security and privacy

- CLI and Rux Native credentials remain isolated; no telemetry or cloud-sync transport is enabled.
- Public Provider endpoints require HTTPS, redirects fail closed, and future persisted-store versions are preserved and rejected.

### Known limits

- macOS output is unsigned until Developer ID and notarization secrets are configured and verified.
- Windows/Linux command sandbox and full packaged security acceptance remain incomplete.
- Update checks stay disabled in unsigned/local packages and until a production HTTPS Feed is embedded.

### Recovery

- Keep the existing application data directory when replacing the binary. Do not launch an older binary against a migrated store unless the release notes explicitly confirm downgrade compatibility.
- External Provider sessions are not deleted by uninstall, local cleanup, or rollback.
