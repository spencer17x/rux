# P1 Session Import desktop evidence

- `01-selected-preview.jpeg`: packaged macOS app after explicit metadata discovery and selection of a real Codex Thread. The preview shows normalized content, the local-copy/sensitive-content and concurrent-writer warning, unsupported content placeholders, and the explicit `仅导入查看` / `导入并继续` choices.
- Captured from an isolated `--user-data-dir`; no import button was pressed against the developer's actual native Session during UI verification.
- The packaged app is unsigned. Automated integration tests cover transactional import, duplicate identity, restart persistence, unavailable native Sessions, normalization, and rollback.
