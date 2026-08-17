# Final Goals packaged desktop QA

Date: 2026-08-17

Artifacts: `app/release-final/mac-arm64/Rux.app` and final rebuilt `app/release/mac-arm64/Rux.app` (ad-hoc local QA builds; no Developer ID)

The earlier packaged application was copied to an isolated bundle identifier (`com.rux.finalqa`). The final rebuilt application was launched directly with fresh user data at `/tmp/rux-final-goals-qa.sJY30V`. Validation used the actual Electron application, not the Web fallback.

## Verified paths

- Opened `账户与登录` → `Agent 与 Provider`.
- Opened the Rux Native protocol selector and confirmed three interactive choices: OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages.
- Selected OpenAI Chat Completions and confirmed its default label and Base URL update in the rendered form.
- Opened `Rux 设置` and confirmed the local Run-success metrics and cross-launch event funnel are visible, keyboard/accessibility exposed, and labelled as local-only with no upload channel.
- Used the native Workspace picker to authorize `/Users/17a/projects/rux` and confirmed the Composer became editable.
- Entered and replaced a Composer draft, explicitly detected the installed official Codex and Claude Code CLIs, and confirmed Send changed from disabled to enabled.
- Sent `Reply exactly QA_OK. Do not use tools or inspect files.` through the packaged Codex adapter. The real Run completed in 5 seconds with `QA_OK`, actual model `gpt-5.6-sol`, and Engine-reported total usage shown in the transcript.
- Opened the Agent selector after the completed Task and confirmed both Codex (current) and Claude Code are selectable, with the new-Task handoff warning visible.
- Opened Settings and confirmed the ad-hoc package reports `正式签名 Feed 未配置`; `检查更新` is disabled and no update request is made.
- Confirmed packaged resources include executable `rux-tui 0.1.0 · protocol v16`, the matching Runtime Host, and an update configuration with `enabled: false`.
- Rebuilt after fixing the welcome-Workspace save race, restarted the same isolated state, confirmed the completed `QA_OK` Task restored, and quit cleanly without the prior unauthorized Task Store error.

## Evidence

- `provider-chat-completions.png`
- `local-success-metrics.png`
- `04-update-settings.png`
- `05-real-codex-dialogue.png`

The package is intentionally not claimed as a production release: this machine has no valid Developer ID identity. The bundle has only an ad-hoc signature with no Team Identifier; signed-feed updates therefore remain fail-closed. Developer ID signing, notarization, production Feed publication, and cross-platform hardware QA remain release blockers.
