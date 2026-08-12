# Rux Desktop Architecture

> Runtime protocol: v3  
> Agent Profile Store: v2  
> Task Store: SQLite schema v2 / Workspace snapshot v2  
> Updated: 2026-08-12

## Process boundaries

```mermaid
flowchart LR
  UI["Sandboxed Renderer"] -->|"typed Preload IPC"| Main["Electron Main"]
  Main -->|"validated protocol v3"| Runtime["Utility Process Runtime"]
  TUI["Rust TUI"] -->|"JSONL protocol v3"| Host["stdio Runtime Host"]
  Runtime --> CLI["Official Codex / Claude Code CLI"]
  Host --> CLI
  Main --> Tasks["Main-owned Task SQLite v2"]
  Runtime --> Profiles["Agent Profile Store v2"]
  Host --> Profiles
  Host --> Tasks
```

- Renderer has no Node integration and receives no filesystem, process, PTY, or credential capability. It can submit only protocol-validated, non-secret object references.
- Main owns the native window, Workspace authorization, IPC routing, and Desktop Task Store access. A read-only Agent Revision resolver validates Task references without exposing the Profile Store to Renderer.
- Utility Process Runtime owns official CLI adapters, authentication delegation, PTY, Git, Context, permissions, and Agent execution.
- The standalone Runtime Host implements the same v3 protocol for the Rust TUI. Unused fields remain ordinary JSON fields so the TUI can evolve independently.

## Provider and credential boundary

`ProviderConnectionRef` is deliberately non-secret. It contains only a stable id, kind, Engine, and display label. The P0 official CLI references are `cli:codex:default` and `cli:claude-code:default`.

Rux never reads CLI credential files, Keychain entries, OAuth tokens, API keys, Base URLs, or arbitrary executable paths. Codex and Claude Code retain ownership of OAuth, API-key, Base URL, cloud-provider configuration, token refresh, and logout. The Renderer runs `auth.status` only after the user clicks the detection action, then refreshes `agent.list` so installation state cannot remain stale. A direct login action delegates only to the selected official command (`codex login` or `claude auth login`); login success updates only that Provider. Renderer-visible status is limited to installation and connection state, normalized auth method, CLI version/path, non-sensitive detail, and the non-secret Connection reference.

## Agent Definition and immutable Revision

The v2 Agent Profile Store separates two meanings that v1 had conflated:

- `storeRevision` serializes cross-process JSON mutations.
- `AgentRevision.revisionNumber` is an immutable product-domain version.

An Agent Definition is the mutable list entry and points to `latestRevisionId`. Create writes Revision 1; every update appends one Revision and moves only the Definition pointer. Deleting a Definition removes it from the selectable list but retains all Revisions for historical Tasks and Runs.

Every Revision captures Engine, `ProviderConnectionRef`, model source and verification state, instructions, permission policy, Skills, Tools, and enabled state. Neither Definition nor Revision accepts secrets, credential paths, or an executable.

### Profile Store v1 to v2 migration

Migration occurs under the sibling-file lock and is persisted with the existing atomic temporary-file, fsync, and rename path. Each v1 Profile maps deterministically to `agent-revision:<profileId>@1`; its original bytes remain represented in the first immutable snapshot. Invalid or future stores fail closed and are not replaced.

## Task and Run binding

Workspace snapshots are version 2. Every Task contains:

- `agentRevisionId`, with an optional immutable snapshot for legacy/custom evidence;
- a non-secret `providerConnection`;
- `modelSource` and `modelVerificationStatus`;
- an explicit adapter/Engine.

Every Run repeats the actual Revision, Connection, and model state and may persist the exact `AgentRevision` snapshot. Built-in Agents use deterministic ids such as `builtin:codex@1`. New custom-Agent Runs must supply the Profile Store's exact `latestRevisionId`; Runtime resolves that Revision rather than silently reading the latest mutable Definition.

Session resume is compatible only when adapter, Profile, Agent Revision, and Provider Connection all match. An existing Task cannot silently switch Agent after it has messages or Runs; a new Task is required.

## Task Store v1 to v2 migration and validation

SQLite migration upgrades `PRAGMA user_version` and every Workspace JSON row in one `BEGIN IMMEDIATE` transaction. A failure parsing or migrating any row rolls back the version and all row writes.

Legacy binding is deterministic:

- A Task/Run with a historical custom-Agent snapshot receives a content-scope `legacy-agent-revision:<sha256>` and a `legacy` model state.
- A Task with no custom evidence binds to its deterministic built-in Revision.
- Provider identity is never guessed. Legacy custom evidence carries an explicit legacy Connection marker; built-in official CLI history uses only the deterministic built-in binding.

Before save/load, Task Store validation rejects:

- a Revision absent from the Agent Profile Store;
- an Engine or Connection that does not match the Revision;
- a custom Revision that does not belong to the referenced Profile;
- fabricated legacy Revision ids not already established by migration;
- a Run that changes Revision or Connection within a non-legacy Task.

## Current implementation truth

- Claude Code and Codex Runs use real local adapters; Rux Demo remains development/Web-preview only.
- Protocol v3, Agent Profile Store v2, Task Store v2, Desktop Runtime, stdio Runtime, Renderer fallback, and Rust TUI share the Revision/Connection contract.
- `账户与登录` is an explicit Agent/Provider connection surface for Rux and Claude Code. Opening the app or panel performs no CLI inspection; missing CLIs link to official installation guidance, while API Key, Base URL, cloud Provider, OAuth storage, refresh, and logout remain CLI-owned.
- Codex has a structured model catalog. Cross-Engine verified-model history and automatic post-Run model verification remain P0-E3 work.
- External Codex/Claude conversation discovery, import, Projection Revisions, and context handoff remain P1 work; this architecture does not claim background conversation synchronization.
- Parts of Changes and Context remain showcase-backed in the Renderer and must not be presented as fully repository-backed until that wiring is complete.
- macOS packages remain unsigned until Developer ID signing and notarization are configured.
