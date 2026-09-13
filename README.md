# Rux

Rux is a local-first Electron desktop workbench for Codex, Claude Code, and Pi. It manages projects and agent-bound conversations, streams native agent events through a shared UI, exposes Git review, and provides project workspace tools.

```bash
pnpm install
pnpm dev
```

Useful commands:

- `pnpm test` runs unit tests, checks Electron/shared TypeScript, and builds the Web and desktop clients.
- `pnpm package` creates an unpacked desktop application for the current platform.
- `pnpm dist` creates distributable desktop artifacts.
- `pnpm test:e2e` builds and exercises the real Electron shell, SQLite persistence, and PTY terminal.

Release signing, notarization, and CI matrix details are documented in `docs/releasing.md`.

The renderer is sandboxed. Codex, filesystem dialogs, Git, terminal, account, model, and system operations are exposed through validated Electron IPC boundaries. Project, thread, and transcript state is stored in SQLite; the terminal uses a native PTY rendered with xterm.

Agent runtimes are pinned and integrity-verified before Rux installs them on first use. Codex uses the active Codex account, Claude Code uses its native account flow, and Pi uses an explicitly configured compatible Provider profile.

## Composer capabilities

- Codex search and planning send explicit settings for both directions, including `web_search: disabled` and the default collaboration mode when switched off.
- Image inputs follow the model's advertised `inputModalities`; both the renderer and main process reject unsupported image requests. Existing attachments stay visible when switching to a text-only model, and sending stays disabled until the mismatch is resolved.
- Custom Responses-compatible services receive prior completed user/assistant turns, including previous attachments. Plan/default instructions are applied on every request. Native sessions and API conversations stay separate; start a new conversation when changing between them.
- Configure image and PDF/Office input support under **Settings → Models and connections** for custom services. UTF-8 text attachments up to 500 KB are included directly; enabled documents/images are limited to 10 MB each. Missing or unsupported files produce an error instead of being silently omitted. Pi profiles accept a fourth model column such as `text,image`.
- On macOS, the microphone uses a bundled Swift helper and the system Speech framework, with on-device recognition preferred when available. No additional API key is needed. First use requires microphone and speech-recognition permission. Other platforms do not expose this macOS-only control.
- Click the microphone to record for up to 60 seconds, then click it again to transcribe. The result is appended to the current draft; cancellation or switching conversations never inserts a late result into another conversation. Recordings are temporary and deleted after processing. Some languages may require Apple's network speech service.

Building the macOS speech helper requires Xcode Command Line Tools. `pnpm dev` and `pnpm build:desktop` compile it automatically; packaged apps include the binary and do not require developer tools.

Protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Responses conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [Apple system speech recognition](https://developer.apple.com/documentation/speech/sfspeechurlrecognitionrequest).
