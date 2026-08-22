# ChatGPT Codex target evidence audit — 26.818.32112

## Audit scope

- Product: official ChatGPT macOS desktop client, Codex workspace.
- Version: `26.818.32112`, released Aug 21, 2026.
- Screenshot pixel size: `2880 × 1624` for the two workspace captures.
- Locale: Simplified Chinese.
- Captured flow: About → main Codex workspace with Environment → account menu.

## Step health

1. **About/version — healthy.** The product, version, release date, and Codex/OWL build identity are legible.
2. **Main workspace — healthy for visual baseline.** Primary navigation, project/task hierarchy, Composer, model/reasoning, permission mode, Environment, Changes count, branch, background process, and Sources are visible in a stable state.
3. **Account menu — healthy for visible gate evidence.** The signed-in identity, remaining usage, Show pet, Invite friends, Settings, and Logout are visible.

## What this proves

- The target version is no longer unknown.
- The target has first-level New chat, Pull requests, Sites, Scheduled, and Plugins navigation.
- The target account visibly receives a remaining-usage summary.
- `Show pet` and `Invite friends` are visible for this account/version. This supersedes any earlier absence assumption.
- The target uses a right Environment panel with Changes, Local, branch, Commit or push, Compare branches, background processes, and Sources.
- The Composer visibly exposes Full access, `5.6 Sol 中`, voice, and send.

## Evidence limits

- Screenshot pixels do not prove the logical CSS viewport or macOS display scale.
- Account plan and region are not visible.
- The screenshots do not show the click-result states for Pull requests, Sites, Scheduled, Plugins, Show pet, Invite friends, Settings, Browser, or Side chat.
- Loading, empty, error, disabled, and recovery states are not covered.
- Screenshots do not prove keyboard behavior, focus order, accessible names, zoom/reflow, or contrast compliance.
- A same-state Rux comparison has not yet been captured at the confirmed target state.

## Verdict

This set is sufficient to establish the target-client version and the main/account visual baseline. It is not sufficient to prove complete parity or to specify the full behavior behind every visible entry.
