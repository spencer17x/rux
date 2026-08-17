# Provider Adapter support, network security, and migration contract

Status: accepted initial contract, 2026-08-17.

This document defines the Provider/Engine combinations Rux currently supports and the compatibility boundary for adding or upgrading an Adapter. It does not grant an Adapter more credential, network, Workspace, or Session authority than the shared Runtime protocol.

## Supported matrix

| Engine / Adapter | Connection and credential owner | Model catalog | Conversation continuity | Streaming and tools | Platform command boundary |
| --- | --- | --- | --- | --- | --- |
| Codex | Official local `codex` CLI; Rux stores only `cli:codex:default` | Official App Server `model/list` | Provider-native Thread id; resume must match Engine, Connection, Revision, and Workspace | Official App Server events and provider-native approvals | Owned by the official CLI and its sandbox |
| Claude Code | Official local `claude` CLI; Rux stores only `cli:claude-code:default` | Engine default, same-Connection verified history, or advanced manual id | Provider-native Session id; resume must match Engine, Connection, Revision, and Workspace | Official stream-json / Agent SDK interfaces and provider-native approvals | Owned by the official CLI and its permission contract |
| Rux Native — OpenAI Responses | Main-owned OS-encrypted API key and optional Custom Headers | Explicit `GET /models`; only returned entries and explicitly reported capabilities are saved | Provider response id saved as `rux-response`; resume remains pinned to the same Connection and Revision | Responses SSE/JSON, function calls, bounded Rux tools | macOS only: structured no-shell command under `sandbox-exec`; unavailable elsewhere |
| Rux Native — OpenAI Chat Completions | Main-owned OS-encrypted API key and optional Custom Headers | Explicit `GET /models`; only returned entries and explicitly reported capabilities are saved | No provider-native Session id. Each Run receives a bounded same-Task user/assistant projection | Chat Completions SSE/JSON, ordered `tool_calls` / `tool` results, bounded Rux tools | macOS only: the same structured no-shell `sandbox-exec` boundary; unavailable elsewhere |
| Rux Native — Anthropic Messages | Main-owned OS-encrypted API key and optional Custom Headers | Explicit `GET /models`; `display_name` is normalized when present | No provider-native Session id. Each Run receives a bounded user/assistant projection from the same Rux Task; this is local reconstruction, not native resume | Messages SSE/JSON, `tool_use` / immediate `tool_result`, bounded Rux tools | macOS only: the same structured no-shell `sandbox-exec` boundary; unavailable elsewhere |

Unsupported combinations fail closed. Rux does not copy official CLI credentials into Rux Native, does not treat Claude subscription login as an Anthropic API credential, and does not claim that locally reconstructed Chat Completions or Messages history is two-way or provider-native synchronization.

## Network security policy

1. Provider traffic occurs only after an explicit Connection test or Run. Startup, account-panel open, model-selector open, and local history browsing do not contact a Provider.
2. Public Base URLs require HTTPS. Plain HTTP is accepted only for the exact loopback hosts `localhost`, `127.0.0.1`, and `[::1]` for explicit local development.
3. Base URLs cannot contain username/password credentials, query strings, or fragments. Keys and Header values use only the encrypted credential channel; they must not be embedded in a URL.
4. Rux appends the supported endpoint (`models`, `responses`, `chat/completions`, or `messages`) to the validated Base URL. Provider redirects fail instead of forwarding a request or managed Header to another origin.
5. Rux manages `Authorization`, `x-api-key`, `anthropic-version`, `Accept`, `Content-Type`, `Content-Length`, `Host`, and `Connection`. User Custom Headers cannot replace them, are rejected on duplicates or line breaks, and remain encrypted/Main-Runtime-only.
6. TLS certificate validation uses the operating system/Node trust path. Rux has no certificate-warning bypass, insecure-TLS switch, or packaged ATS exception.
7. Catalog calls have a 15-second timeout. Runs are bound to the Run abort controller; Stop terminates the request and any active command process tree. Provider and tool errors are bounded and redacted before they reach Renderer-visible state.
8. A configured custom HTTPS endpoint is an explicit data destination: Run prompts, selected Context, tool results, and conversation history can be sent to it. Connection labels do not change this trust boundary.
9. Rux Native command tools cannot make network requests inside the macOS sandbox. Platforms without an equivalent command sandbox do not expose the command tool.

## Capability negotiation rules

- A model or capability is usable as catalog evidence only when the supported Engine/Provider interface reports it, or when a successful Run verifies that model for the same Engine and non-secret Connection reference.
- Missing catalog or capability fields stay unknown. Rux does not infer per-Run model switching, tool availability, context limits, pricing, or billing accuracy.
- Network, authentication, quota, timeout, and transient Provider failures do not permanently mark a model unavailable.
- Adding a protocol requires fixtures for authentication headers, redirect refusal, catalog normalization, streaming, tool-call/result ordering, cancellation, error redaction, usage normalization, and credential non-disclosure.

## Cross-version migration contract

- Runtime protocol compatibility is an exact version handshake. Desktop, stdio Host, and TUI must reject an incompatible protocol before launching a Run; a protocol bump updates all three together.
- SQLite Task Store migrations run in one immediate transaction. A row or schema failure rolls back the version and every write. A future schema version is read-only rejected and never downgraded.
- Agent Profile migrations preserve immutable Revision identity and fail without replacing a corrupt or future-version store.
- Native Provider Store v1 preserves ciphertext bytes and rejects writes when JSON is corrupt, the version is newer than supported, or OS encryption is unavailable. It never resets an unreadable/future store to an empty writable state.
- A migration must not decrypt and re-persist a credential merely to change non-secret metadata. If a future credential format requires re-encryption, it needs an explicit versioned migration, a recoverable backup/rollback path, and a user-visible impact report.
- Provider-type, Engine, Connection, Agent Revision, Task, Native Session, and imported Projection identities are stable migration keys. A migration cannot silently rebind them, merge histories across Connections, or turn local history into a claimed native Session.
- Releases that change a persisted store or protocol must include old-version fixtures, future-version refusal tests, rollback/failure tests, a packaged upgrade smoke test, and release notes describing recovery.

## Adding another Provider protocol

Before enabling a new protocol in the account UI:

1. Add its exact auth/session/catalog/stream/tool/usage behavior to the matrix.
2. Reserve every transport Header Rux must own and prove Custom Headers cannot override it.
3. Decide whether continuity is provider-native, Rux-local reconstruction, or unsupported; never silently substitute one for another.
4. Define allowed Base URL and redirect behavior without weakening this network policy.
5. Add protocol, Adapter, store, Renderer, release-boundary, and packaged desktop tests.
6. Bump the shared Runtime protocol when the wire contract changes and document migration/recovery behavior.
