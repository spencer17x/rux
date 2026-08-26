# Rux Open-source Component Strategy

Date: 2026-08-26

## Principle

Use mature libraries for generic interaction infrastructure. Keep custom code only for Rux's product model, Codex/Claude/Pi protocol adapters, security boundaries, and brand-specific styling.

## Replacement matrix

| Current Rux surface | Current implementation | Adopt | Decision |
| --- | --- | --- | --- |
| Conversation runtime | Custom arrays, localStorage, hand-written message loop | `@assistant-ui/react` External Store Runtime | Replace |
| Message, composer, scrolling, stop/retry | Custom React/CSS | assistant-ui primitives | Replace |
| Markdown and code blocks | Plain text | assistant-ui Markdown adapter; Shiki-backed code blocks where needed | Replace |
| Reasoning, tool calls, approvals | Not fully implemented | assistant-ui Reasoning/Tool UI/approval gate | Adopt |
| Streaming event state | Buffered IPC response | AgentAdapter event stream + assistant-ui runtime | Replace |
| App layout and split panes | Fixed flex dimensions | `react-resizable-panels` | Replace |
| Terminal rendering | `@xterm/xterm`, `@xterm/addon-fit`, `node-pty` | Keep and extend with terminal lifecycle tests | Adopted |
| Project/file tree | Flat recursive file list | `react-arborist` | Replace |
| Source viewer and Git diff | Plain `<pre>` text | CodeMirror 6 and `@codemirror/merge` | Replace |
| Async model/account/Git queries | Component-owned effects | `@tanstack/react-query` | Adopt |
| Non-chat UI state | Many component state variables | `zustand` slices | Adopt |
| Settings and Provider forms | Hand-written inputs | TanStack Form + Zod schemas | Adopt |
| Runtime IPC validation | Type assertions/manual checks | Zod shared schemas | Adopt |
| Resizable tool logs/file lists | Unbounded DOM lists | `@tanstack/react-virtual` where needed | Adopt |
| Menus, dialogs, dropdowns, popovers | Hand-written positioning | Radix UI primitives | Replace selectively |
| Toasts | Custom fixed div | Sonner | Replace |
| Command palette | Not implemented | `cmdk` | Adopt |
| Hotkeys | Global manual keydown handler | `react-hotkeys-hook` | Replace |
| Git process wrapper | Manual spawn argument handling | `simple-git` for normal Git operations; retain explicit subprocesses for security-sensitive cases | Replace selectively |
| Embedded browser | External browser only | Electron `WebContentsView` in main process | Adopt when browser panel is implemented |
| Secret storage | Electron `safeStorage` | Electron `safeStorage` | Keep |
| Native file/folder dialogs | Electron dialog IPC | Electron dialog | Keep |
| Icons | Phosphor Icons | Phosphor Icons | Keep |

## Why assistant-ui

assistant-ui is the closest match for a native coding-agent event log:

- External Store Runtime works with an existing state/event source.
- Tool UI supports streaming arguments, running/completed/error states, and external tools.
- Approval gates support allow/deny and scoped options.
- Conversation primitives cover message alignment, auto-scroll, actions, attachments, branching, cancel, and retry.
- Rux retains full control over Codex-style visual tokens and specialized tool renderers.

Rux should not use AI SDK `useChat` as the source of truth. The selected coding agent owns the real session and event lifecycle.

## Libraries not selected as the conversation foundation

### Vercel AI Elements

Useful as a visual/component reference, but its recommended setup brings shadcn/ui, Tailwind, and AI SDK assumptions into a Vite/Electron app. Individual source components may be reused only when they add clear value beyond assistant-ui.

### Ant Design X

Strong Bubble, Sender, Markdown, and ThoughtChain components, but it would introduce a second visual system and still requires a custom agent runtime. It is not selected for the Rux conversation foundation.

### CopilotKit

Powerful full-stack agent UI and AG-UI runtime, but converting Codex/Claude/Pi into AG-UI would duplicate the AgentAdapter layer and add a second orchestration model. It is too heavy for the local-first desktop runtime.

## Terminal

Use the established Electron architecture:

```text
node-pty (main process) <-> validated IPC <-> xterm.js (renderer)
```

This adds PTY resize, colors, cursor behavior, shell applications, IME support, links, search, and accessibility that the current `<pre>` terminal cannot provide.

## Browser

Use Electron `WebContentsView`; do not use deprecated `BrowserView` or enable the `<webview>` tag. Navigation, downloads, permissions, and new-window behavior remain main-process controlled.

## Persistence

- Agent-native session logs remain authoritative for transcript/tool history.
- Rux persists the cross-agent index, project/thread metadata, layouts, provider profiles, and handoff relationships.
- Workspace, thread, and transcript state uses SQLite with a typed schema and one-time migration from legacy JSON/localStorage.
- Keep secrets in `safeStorage`; the database stores only secret references.

## Dependency phases

### Foundation

- `@assistant-ui/react`
- assistant-ui Markdown package selected from its current installer
- `zustand`
- `zod`
- `@tanstack/react-query`
- Radix primitives required by assistant-ui

### Developer workspace

- `react-resizable-panels`
- `@xterm/xterm`
- `@xterm/addon-fit`
- `node-pty`
- `react-arborist`
- CodeMirror 6 packages including `@codemirror/merge`

### Interaction polish

- TanStack Form
- `@tanstack/react-virtual`
- `sonner`
- `cmdk`
- `react-hotkeys-hook`
- `simple-git`

Do not install every package in one change. Each phase must remove the corresponding custom implementation and include interaction UAT before the next phase starts.
