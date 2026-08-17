# Rux Native Anthropic Messages desktop acceptance

Date: 2026-08-17

- Built and packaged `app/release/mac-arm64/Rux.app`.
- Launched an isolated app copy with an independent bundle id and user-data directory.
- Opened `账户与登录` → `Rux Native Provider`.
- Changed the protocol from `OpenAI Responses` to `Anthropic Messages`.
- Verified the visible name changed to `Anthropic` and Base URL changed to `https://api.anthropic.com/v1`.
- Entered a disposable model id and non-secret Custom Header value; both fields remained editable.
- Did not enter or save an API key, contact a Provider, or inspect real CLI credentials.

Evidence: `anthropic-connection-interactions.png`.
