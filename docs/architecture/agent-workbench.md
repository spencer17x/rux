# Rux Agent Workbench Architecture

Date: 2026-08-26

## Decision

Rux becomes a multi-agent desktop workbench with a shared conversation shell and native adapters for each supported coding agent. The first adapters are:

- `codex` — Codex App Server JSON-RPC
- `claude-code` — Claude Agent SDK for TypeScript
- `pi` — Pi RPC subprocess first, SDK integration optional later

The shared UI must not reduce every agent to a lowest-common-denominator feature set. Common controls are normalized, while agent-specific modes and capabilities are declared dynamically by each adapter.

## Runtime boundaries

```text
assistant-ui (renderer)
  -> Rux canonical messages and commands
  -> sandboxed preload IPC
  -> AgentRuntimeManager (Electron main)
      -> CodexAdapter
      -> ClaudeCodeAdapter
      -> PiAdapter
  -> native agent event stream
  -> CanonicalEventReducer
  -> assistant-ui ExternalStoreRuntime
```

The renderer never imports an agent SDK, reads credentials, or spawns agent processes. Agent SDKs and subprocesses live in the Electron main process.

## Core contracts

```ts
type AgentId = "codex" | "claude-code" | "pi";

type AgentCapability =
  | "streamingText"
  | "reasoning"
  | "toolCalls"
  | "fileChanges"
  | "approvals"
  | "interrupt"
  | "resume"
  | "fork"
  | "mcp"
  | "webSearch"
  | "subagents"
  | "dynamicModelSwitch"
  | "dynamicModeSwitch";

interface AgentDescriptor {
  id: AgentId;
  displayName: string;
  version?: string;
  installed: boolean;
  authenticated: boolean;
  capabilities: AgentCapability[];
  modes: AgentMode[];
}

interface AgentMode {
  id: string;
  label: string;
  description: string;
  permissionPreset?: string;
  fields?: AgentModeField[];
}

interface AgentModel {
  agentId: AgentId;
  providerId: string;
  modelId: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
  reasoningLevels: string[];
  inputModalities: string[];
}

interface AgentSessionRef {
  agentId: AgentId;
  nativeSessionId: string;
  projectId?: string;
  modeId: string;
  modelRef: string;
  providerProfileId?: string;
}

interface AgentAdapter {
  detect(): Promise<AgentDescriptor>;
  getAuthState(): Promise<AgentAuthState>;
  login(): Promise<void>;
  logout(): Promise<void>;
  listModels(): Promise<AgentModel[]>;
  createSession(input: CreateSessionInput): Promise<AgentSessionRef>;
  resumeSession(ref: AgentSessionRef): Promise<void>;
  send(input: SendTurnInput): AsyncIterable<CanonicalAgentEvent>;
  interrupt(sessionId: string): Promise<void>;
  respondToApproval(input: ApprovalResponse): Promise<void>;
  dispose(sessionId: string): Promise<void>;
}
```

## Canonical event model

The event layer maps native agent events to assistant-ui message parts. It preserves native metadata so no information is lost.

```ts
type CanonicalAgentEvent =
  | { type: "text-delta"; itemId: string; delta: string }
  | { type: "reasoning-delta"; itemId: string; delta: string }
  | { type: "tool-start"; itemId: string; toolType: string; title: string; input?: unknown }
  | { type: "tool-output-delta"; itemId: string; delta: string }
  | { type: "tool-complete"; itemId: string; output?: unknown; error?: string }
  | { type: "file-change"; itemId: string; files: FileChange[]; status: EventStatus }
  | { type: "approval-request"; request: AgentApprovalRequest }
  | { type: "usage"; usage: AgentUsage }
  | { type: "turn-complete"; nativeTurnId: string }
  | { type: "error"; message: string; recoverable: boolean };
```

## Agent-specific behavior

### Codex

Integration: persistent `codex app-server --stdio` child process, JSON-RPC requests, notifications, and server-initiated approval requests.

Native modes shown in UI:

- Default
- Plan

Dynamic controls:

- Model from `model/list`
- Reasoning effort from each model's advertised capabilities
- Permission/approval profile
- Service tier when advertised
- Personality and collaboration mode only when available

Native events retained: agent text deltas, reasoning summaries, command execution, file changes, MCP calls, web search, subagent activity, approvals, token usage, and turn completion.

### Claude Code

Integration: `@anthropic-ai/claude-agent-sdk` in streaming-input mode with partial messages enabled. Use the installed Claude Code binary when available instead of accessing credential files.

Native modes shown in UI:

- Default
- Plan
- Accept edits
- Don't ask
- Auto approval
- Bypass permissions

Dynamic controls:

- Models from `supportedModels()`
- Agents from `supportedAgents()`
- Permission mode from the SDK
- Effort/thinking controls when supported
- MCP status and reconnect controls

Native events retained: partial assistant stream events, text, thinking, tool use/results, hooks, task progress, subagents, permission denials, result/cost, and session state.

### Pi

Integration: isolated `pi --mode rpc` subprocess using strict LF-delimited JSON. The SDK can replace RPC after its package/API version is pinned.

Native modes shown in UI are capability-derived, not fabricated:

- Coding tools
- Read-only tools
- Additional modes registered by installed Pi extensions

Pi does not receive a synthetic Plan mode unless an installed extension explicitly provides one.

Dynamic controls:

- Provider/model catalog from Pi's model registry/RPC
- Thinking levels: off, minimal, low, medium, high, xhigh when supported
- Session continue/resume/fork
- Extension, skill, prompt-template, and package state

## Agent switching rules

A native session is permanently bound to its agent. Codex, Claude Code, and Pi session IDs are not interchangeable.

- Before the first message: agent can be changed freely.
- After a session starts: selecting another agent opens a switch dialog.
- `Start clean`: create a new native session with no inherited transcript.
- `Handoff context`: create a new native session with an explicit Rux-generated context package containing the user goal, recent user messages, completed tool summaries, and current Git state.
- Never silently replay private reasoning, raw credentials, or full tool logs into another agent.
- The Rux conversation records agent lanes so the user can see where a handoff occurred and return to an earlier native session.

## Composer hierarchy

The composer control order is:

```text
Agent -> Agent mode -> Model -> Reasoning/thinking -> Permissions -> Send
```

Unsupported controls are hidden. They are not shown disabled and are not emulated with misleading values.

Agent selection changes all downstream controls:

- Codex selected: Codex modes, Codex models, Codex reasoning and permission profiles
- Claude Code selected: Claude modes, supported models, effort and permission mode
- Pi selected: Pi tool mode, provider/model pair and thinking level

## Provider and model configuration

```ts
interface ProviderProfile {
  id: string;
  name: string;
  protocol: "openai-responses" | "openai-chat" | "anthropic-messages" | "google" | "ollama" | "custom";
  baseUrl?: string;
  apiKeySecretId?: string;
  headers?: Record<string, string>;
  compatibleAgents: AgentId[];
  models: ProviderModelConfig[];
}
```

- API keys remain in Electron `safeStorage` and never reach the renderer.
- Model profiles are filtered by the selected agent's real compatibility.
- Codex custom providers are passed as per-thread App Server configuration, not written into the user's global Codex files.
- Claude Code provider overrides use supported SDK settings/environment boundaries only.
- Pi custom providers use its model/provider registry and are the most flexible option.
- A direct OpenAI-compatible provider without a coding-agent runtime is represented as a separate future Rux Native adapter, not mislabeled as Codex/Claude/Pi.

## Installation and availability UX

Settings includes an Agents page with one card per adapter:

- detected executable/SDK version
- authentication state
- supported capabilities
- native login action
- install documentation when unavailable
- diagnostic output and reconnect/restart action

Current machine state at design time:

- Codex `0.147.0`: installed
- Claude Code `2.1.206`: installed
- Pi: not installed

Rux may install a pinned, integrity-verified managed runtime on first use while
showing download and installation progress. It does not mutate an agent's global
credentials or copy credentials into the Renderer.

## Migration order

1. Convert the monolithic renderer from JSX to typed TSX modules.
2. Add assistant-ui and replace the custom conversation/message/composer implementation.
3. Introduce the canonical event reducer and persistent Codex App Server adapter.
4. Add Agent selector, capability-driven modes, model catalog, and provider profiles.
5. Add Claude Code adapter.
6. Add Pi RPC adapter and installation diagnostics.
7. Add cross-agent handoff lanes.
8. Remove legacy buffered `codex exec` and custom message rendering.
