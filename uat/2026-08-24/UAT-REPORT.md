# Rux Desktop UAT Report

Date: 2026-08-24  
Environment: macOS, Electron development client (`localhost:5173`)  
Build verification: `pnpm test` passed  
Verdict: **REJECT — visual prototype is stable, but core product functions are not implemented**

## Scope

The UAT covered client launch, project and conversation navigation, add/import/create project flows, standalone conversations, change review, terminal, model and connection settings, and message submission.

## Step results

| Step | Scenario | Health | Evidence |
| --- | --- | --- | --- |
| 1 | Launch the current development client | PASS | `01-launch-dev.png` |
| 2 | Open the add-project choice | PASS | `02-add-project.png` |
| 3 | Continue to local/Git project import | PARTIAL | `03-import-project.png` |
| 4 | Open and edit the new-project form | PASS (UI only) | `04-create-project.png` |
| 5 | Submit project creation | FAIL | `05-create-success.png` |
| 6 | Switch to an independent conversation | PASS (navigation only) | `06-standalone-conversation.png` |
| 7 | Review generated file changes | PARTIAL | `07-review-changes.png` |
| 8 | Expand and use the terminal | FAIL | `08-terminal.png` |
| 9 | Configure OAuth, Base URL, model and reasoning | FAIL | `09-model-settings.png` |
| 10 | Send a conversation message | FAIL | `10-message-send-noop.png` |

## Blocking findings

### [P1] Conversation send is a no-op

- Evidence: after entering `UAT：请回复这条消息` and clicking Send, the text remains in the composer and no user message, loading state, response, or error appears (`10-message-send-noop.png`).
- Impact: the primary coding-agent task cannot be completed.
- Acceptance condition: submit messages, clear the composer, render a pending state, and return either an agent response or an actionable error.

### [P1] Project create/import reports success without creating or importing a project

- Evidence: project creation accepts edited values and shows `项目已创建`, but `uat-project` does not appear in the project tree and no project is created on disk (`05-create-success.png`). Import fields likewise do not invoke a file chooser or clone operation.
- Impact: users receive a false success signal and cannot establish a working project.
- Acceptance condition: perform the selected filesystem/Git action, add the project to the tree, create its first conversation when selected, and report recoverable errors.

### [P1] Model and connection settings do not persist

- Evidence: changing Base URL to `https://uat.example/v1`, selecting `极高`, and clicking `保存服务` shows a success toast; after leaving and reopening settings, Base URL returns to `https://api.example.com/v1` and reasoning returns to `高`.
- Impact: custom endpoints and model defaults cannot be used reliably.
- Acceptance condition: persist settings securely, reload them on entry/restart, validate endpoints, and never expose API keys to the renderer or logs.

### [P1] Terminal is a static visual

- Evidence: the terminal exposes preset output but no editable terminal input or command execution surface (`08-terminal.png`).
- Impact: coding-agent verification and manual command execution are unavailable.
- Acceptance condition: provide a sandboxed PTY boundary through the Electron main/preload layers, stream output, support cancellation, and scope commands to the active project.

### [P1] Change review is not connected to real repository changes

- Evidence: review shows fixed mock files and diff content; applying or discarding does not operate on the workspace.
- Impact: users cannot trust review, apply, or discard actions.
- Acceptance condition: derive diffs from the selected project, show file-specific content, apply/discard changes safely, and refresh Git status.

### [P1] OAuth state is simulated

- Evidence: the client opens with a fixed connected identity and the login controls only change local UI state.
- Impact: authenticated model access is unavailable.
- Acceptance condition: implement the real OAuth flow in a privileged boundary, securely store tokens, support refresh/logout, and surface auth errors.

## Release and packaging finding

### [P2] Existing packaged `Rux.app` is stale and blank

- Evidence: launching the existing packaged app from `release/mac-arm64/Rux.app` displays an empty white renderer (`01-launch.png`), while the development Electron client contains the new UI.
- Impact: a tester who launches the packaged client will validate the wrong build.
- Acceptance condition: rebuild/package after functional fixes, replace or clearly version the stale artifact, then rerun UAT on the packaged application.

## UX strengths

- Project conversations are clearly nested under their owning project; independent conversations are visibly separate.
- Add/import/create flows have clear labels, sensible defaults, and consistent back/close actions.
- Review, terminal, and settings states preserve a stable desktop layout.
- Accessibility tree exposes meaningful roles and accessible names for major buttons, inputs, headings, checkboxes, and dialogs.

## UX and accessibility risks

- Many visible controls remain static: search, notifications, open location, share, web search, file attachment, microphone, refresh-model list, and several toolbar actions.
- Icon-only targets are approximately 32 px; keyboard focus is present, but target sizing and complete keyboard traversal need dedicated testing.
- Screenshots and the macOS accessibility tree support a structural check only; this run does not claim WCAG compliance or screen-reader compatibility.
- No validation/error states were available for invalid paths, duplicate project names, bad URLs, network failures, auth failures, or command failures.

## Acceptance gate

Rux is acceptable as a **visual interaction prototype**. It is **not acceptable as a functional coding-agent UAT candidate** until all P1 findings are implemented and the packaged client is rebuilt and retested.
