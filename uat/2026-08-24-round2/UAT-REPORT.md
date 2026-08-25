# Rux Desktop UAT — Round 2

Date: 2026-08-24  
Target: `/Users/17a/projects/rux/release/mac-arm64/Rux.app`  
Build verification: `pnpm test` passed  
Verdict: **PASS — all first-round P1 blockers are closed for the tested local macOS flow**

## Post-round-2 corrective UAT — 2026-08-25

Three interaction gaps reported after the original pass were fixed and re-tested against a newly packaged client:

| Scenario | Result | Evidence |
| --- | --- | --- |
| Remove a project from the sidebar | PASS | Packaged client exposes an accessible remove action and a confirmation stating that only the Rux association is removed. A test project was removed from `workspace.json`; its directory remained on disk. |
| Switch models using the same catalog as local Codex | PASS | The packaged client loaded `model/list` from the installed Codex App Server and exposed the returned models, descriptions, default marker, and current selection. Switching from GPT-5.6-Sol to GPT-5.6-Terra persisted to `settings.json`. |
| Switch reasoning effort, including `xhigh` | PASS | The picker was populated from the selected model's `supportedReasoningEfforts`. The test changed `high` to `xhigh` and confirmed the persisted value and updated composer label. GPT-5.6-Terra also exposed its currently advertised `max` and `ultra` levels. |

The corrective package is `/Users/17a/projects/rux/release/mac-arm64/Rux.app`. `pnpm test` and `pnpm package` both passed.

## Step results

| Step | Scenario | Health | Evidence |
| --- | --- | --- | --- |
| 1 | Launch rebuilt packaged app | PASS | `01-packaged-launch.png` |
| 2 | Load persisted project and reasoning configuration | PASS | `02-persisted-project.png` |
| 3 | Send through real Codex ChatGPT OAuth session | PASS | `03-codex-response.png` |
| 4 | Execute a real shell command in the project | PASS | `04-terminal-command.png` |
| 5 | Read real Git status and diff, including unborn branch | PASS | `05-real-git-review.png` |
| 6 | Reload persisted OAuth/Base URL/reasoning settings | PASS | `06-persisted-settings.png` |
| 7 | Create a real project from packaged app | PASS | `07-packaged-project-create.png` |
| 8 | Fully quit and relaunch; projects remain | PASS | `08-relaunch-persistence.png` |
| 9 | Reopen prior conversation; transcript remains | PASS | `09-conversation-persistence.png` |
| 10 | Stage a real Git file from review UI | PASS | `10-git-stage-success.png` |

## Closure of first-round P1 findings

### Message submission and agent execution — closed

- Packaged app sent `Reply with exactly PACKAGED_UAT_OK. Do not modify files.`.
- The response `PACKAGED_UAT_OK` came from the locally installed Codex CLI using the existing ChatGPT login.
- The conversation remained visible after a full packaged-app quit and relaunch.

### Project create/import persistence — closed for create flow

- Packaged app created `/Users/17a/Documents/Rux Projects/rux-packaged-uat-20260824`.
- `README.md` exists on disk.
- The new project was added to the sidebar and remained after a full process restart.
- Folder import and Git-clone handlers are implemented; destructive or network-heavy Git clone was not repeated during this UAT.

### Settings and OAuth — closed for default OAuth flow

- `codex login status` reports `Logged in using ChatGPT` inside the packaged app.
- Base URL `https://uat.persisted/v1` and `xhigh` reasoning remained after leaving settings, packaging, and restarting the app.
- API keys are encrypted in the Electron main process with the OS secure-storage API and are not returned to the renderer.
- Custom-provider live API response was not tested because no custom API key was supplied.

### Terminal — closed

- Terminal started with the active project as cwd.
- `pwd && cat uat.txt` executed in the packaged app and returned the real path and file content.

### Git review and staging — closed

- Review loaded real status for `README.md` and `uat.txt`.
- Diff for a staged file in a repository without a first commit rendered correctly after an iteration fix.
- `暂存此文件` executed a real `git add`; repository status confirmed staged files.
- Destructive discard was not executed; the UI requires confirmation and deliberately refuses to delete untracked files automatically.

## Security boundary checked

- Renderer remains sandboxed with `contextIsolation: true` and no Node.js access.
- Privileged operations are exposed through explicit preload IPC methods.
- Project, Git, terminal, and open-path operations require a registered project ID.
- Codex runs with the workspace-write sandbox rather than bypassing approvals and sandboxing.
- Shell commands run only in the active registered project directory.

## Residual non-blocking findings

- [P2] macOS package is unsigned; Gatekeeper/distribution signing was not available in this environment.
- [P3] Untracked-file line counts display `+0 −0` even though file-level status and diff content are correct.
- [P3] The app opens the first project after restart instead of restoring the last active project.
- [Evidence gap] Custom OpenAI-compatible endpoint was implemented but not live-tested without a user-supplied API key.
- [Evidence gap] OAuth logout/re-login was not executed to avoid disrupting the user's working ChatGPT session; login status and real response were verified.
- [Accessibility limit] Roles, labels, inputs, dialogs, and focusable controls were present in the macOS accessibility tree. This does not constitute full WCAG or screen-reader certification.

## Artifacts created during UAT

- `/Users/17a/Documents/Rux Projects/rux-uat2-20260824`
- `/Users/17a/Documents/Rux Projects/rux-packaged-uat-20260824`

These projects are intentionally retained as UAT evidence and were not deleted.

## Acceptance gate

The rebuilt package passes the requested second-round local functional UAT. It is suitable for continued development and internal local testing. Public distribution still requires signing, a product icon, and a separate custom-provider/API-key test.
