# Design QA — Codex 26.810.52044 alignment

## Evidence

- Source visual truth path: unavailable. The installed reference application is `/Applications/ChatGPT.app` version `26.810.52044`, but direct capture of `com.openai.codex` is blocked by the desktop automation safety boundary. The user-supplied image at `design-audit/codex-26.810.52044-alignment-2026-08-16/00-user-reported-divergent-state.png` is the RUX state being rejected, not the target Codex screen.
- Interaction reference: the installed `app.asar` assets supplied the 26.810.52044 approval, composer, task, and menu strings; repository-approved Codex layout anchors supplied the desktop dimensions and rail proportions.
- Implementation screenshots:
  - `design-audit/codex-26.810.52044-alignment-2026-08-16/01-packaged-blank-task.jpeg`
  - `design-audit/codex-26.810.52044-alignment-2026-08-16/02-packaged-real-chat.jpeg`
  - `design-audit/codex-26.810.52044-alignment-2026-08-16/03-web-blank-task-1433x812.png`
  - `design-audit/codex-26.810.52044-alignment-2026-08-16/04-packaged-codex-session-and-stop.png`
- Viewports and density:
  - User-reported divergent state: 2866 × 1624 pixels, representing a 1433 × 812 CSS viewport at 2× density.
  - Browser implementation: 1433 × 812 pixels at 1× density.
  - Packaged desktop implementation: 1356 × 768 pixels at 1× capture density.
- States: focused blank Task, approval-mode menu, real Rux/Codex conversation completed with `RUX_CHAT_OK`, and a real Claude Code launch reaching the Provider without the obsolete whole-Run gate.

## Findings

- [P1] Exact pixel-level Codex comparison is unavailable.
  - Location: full desktop shell and Composer.
  - Evidence: the exact-version application package and its interface strings/tokens were inspectable, but its UI could not be captured. The supplied screenshot is explicitly the rejected RUX implementation and does not represent the target state.
  - Impact: interaction parity and repository layout anchors can be verified, but typography, spacing, and token differences cannot honestly be certified against a same-state official Codex screenshot.
  - Fix: obtain a user-supplied screenshot of Codex 26.810.52044 in the blank-Task and approval-menu states, then repeat a same-viewport side-by-side comparison.

## Full-view comparison evidence

The earlier RUX state showed a large whole-Run Workspace approval and a custom Composer lock path. The revised implementation shows a clean blank Task with a focused bottom Composer and no setup modal or waiting card. A real packaged Run starts without the old whole-Run gate and completes inline. Because the earlier screenshot is a rejected state rather than the target design, this is behavioral before/after evidence, not a valid pixel-fidelity pass.

## Focused region evidence

The packaged approval-mode control was inspected through its visible accessibility tree. It exposes `请求批准`, `自动批准`, and `只读` as selectable menu items with descriptions. The plus control is separately named `添加文件和更多`, and Agent/model/voice/send remain independent controls. A same-state official Composer crop was unavailable, so focused visual comparison remains blocked.

## Comparison history

1. Initial inspection found two P1 interaction mismatches: `新对话` opened a RUX-specific setup dialog, and Claude Code used a coarse whole-Run Workspace preflight. The Composer also used one shared settings popover and a custom read-only strip.
2. Fixes applied: direct focused blank Task creation for sidebar/project/keyboard actions; separate approval menu; removal of the custom strip and blank-state card; provider-native approvals for Codex and Claude Code; compact neutral approval card copy and styling.
3. Post-fix evidence: browser render at 1433 × 812 had no console warnings/errors; packaged blank Task exposed all expected controls; packaged Rux Run returned `RUX_CHAT_OK` in 5 seconds using `gpt-5.6-sol`; the temporary QA Tasks were archived.
4. The first packaged Claude attempt exposed a real adapter defect: Claude's variadic `--mcp-config` option consumed the prompt as another config path. The adapter now places the prompt after `--`, with fresh adapter and permission-broker regression coverage.
5. The rebuilt packaged app then launched Claude immediately without a coarse RUX permission card and reached the configured Provider. That Provider rejected the locally configured `grok-4.5` credential with `403 API Key 所属分组已删除`; RUX surfaced the authentication failure inline and did not silently create a replacement Session. This remaining failure is local Provider credential state, not an input or dispatch failure.
6. Final packaged QA verified explicit Agent detection, restart reuse of the cached non-sensitive status without an automatic CLI check, native Workspace file selection, removable Composer Context chips, Codex selection, a completed `OK` response, a same-Session `PONG` continuation with actual model/Token evidence, and explicit Run Stop. The first cold Codex attempt revealed that official `thread/start` completed after about 35.8 seconds on this installation; the adapter now gives only `thread/start/resume` a bounded 120-second initialization window while ordinary RPC calls remain at 30 seconds. The rebuilt package completed both fresh and resumed Codex turns.

## Required fidelity surfaces

- Fonts and typography: implementation uses the existing system/Codex-like sans stack and compact optical weights; exact target comparison is blocked.
- Spacing and layout rhythm: 240 px sidebar, 46 px toolbar, 736 px centered rail, bottom Composer, and restrained blank state are preserved; exact target comparison is blocked.
- Colors and tokens: pale flat sidebar, white canvas, neutral menus/cards, and limited semantic color are present; exact token comparison is blocked.
- Image quality and assets: no bespoke raster imagery is required; existing Lucide icons are used consistently.
- Copy and content: primary new-Task, Composer, approval, and provider-native permission wording now follows the extracted 26.810.52044 interaction contract while retaining the Rux product name.

## Implementation checklist

- [x] Direct blank Task from `新对话`, project new-task action, and `Cmd/Ctrl+N`.
- [x] Separate Composer plus and approval controls.
- [x] Concrete provider-native approvals for Codex and Claude Code.
- [x] Read-only imports use `复制为新任务` without a custom Composer strip.
- [x] Browser, packaged desktop, full test, build, package, and real Codex chat verification.
- [x] Claude input/dispatch and provider-native permission path verified through the packaged app; Provider response currently stops at the local credential's explicit 403 error.
- [x] Native Workspace file Context add/remove, cached non-sensitive Agent state, fresh Codex chat, same native Session continuation, actual model/Token evidence, and Stop verified in the rebuilt packaged app.
- [ ] Repeat pixel comparison when an official same-state Codex screenshot is available.

final result: blocked
