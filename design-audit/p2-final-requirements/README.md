# P2 final requirements desktop acceptance

Date: 2026-08-15  
App: `app/release/mac-arm64/Rux.app` (unsigned macOS arm64 package)  
Viewport: 1356 × 768  
Environment: isolated `/private/tmp` user-data, local Fake Responses Provider, Electron `--use-mock-keychain`; no real Provider, OAuth state, API key, or developer Keychain entry was used.

## Accepted path

1. Clean packaged-app startup kept the composer anchored at the bottom and did not require a Codex or Claude Code CLI.
2. Added a Rux Native Connection using a fake localhost key. Renderer displayed only masked input and sanitized Connection metadata.
3. Explicit **刷新目录与测试** read one Provider-returned model and displayed its source, refresh time, and `逐 Run 换模：Provider 未报告` without inferring support.
4. **编辑** prefilled non-secret metadata. The API Key field remained blank with `留空保留当前 Key；填写则替换`; the action label distinguished metadata save from key replacement.
5. Saving entered the Main-generated impact confirmation. It named the affected Agent and Task count and stated that immutable Agent Revisions and Tasks would not be rewritten. The acceptance run cancelled at this confirmation, so no unnecessary metadata mutation occurred.

## Evidence

- `native-catalog.jpeg`: stable catalog/capability result after the explicit Provider test.
- `connection-edit.jpeg`: metadata edit form and blank-key preservation semantics.
- `impact-confirm.jpeg`: Agent/Task impact confirmation before mutation.

Automated coverage separately verifies fresh fingerprint enforcement, stale-preview rejection, encrypted-key preservation/replacement/deletion, same-Connection Auto catalog validation, explicit session model-switch capability, global Session identity migration, and non-secret Renderer boundaries.

Known external release limitation: the package remains unsigned and unnotarized because no Developer ID identity is configured.
