# Rux Projects rail visual review

Date: 2026-08-14

## Scope

Review the packaged macOS Projects rail against the repository's accepted Codex Desktop direction: compact single-line navigation, flat hierarchy, restrained state, and visible labelled actions.

## Steps

1. **Existing Projects rail — needs refinement.** The current Workspace marker reads visually like a count, the selected Task combines a heavy neutral fill with an accent stripe, and the hierarchy guide competes with the content. Evidence: [01-before-sidebar.png](01-before-sidebar.png).
2. **Refined Projects rail — healthy.** Project and Task rows use a 30 px rhythm, the footer remains the single current-Workspace indicator, the selected Task uses one soft neutral fill, the guide is quieter, and expand chevrons remain available on hover/focus without cluttering the resting list. Evidence: [02-after-sidebar.png](02-after-sidebar.png).

## UX and accessibility notes

- Project headings remain labelled buttons with `aria-expanded`; Task selection retains `aria-current="page"`.
- Important actions remain text-labelled: `在此项目中新建任务`, `打开项目…`, and `账户与登录`.
- The refined row heights are visually compact. Keyboard focus, zoom reflow, and contrast still require behavioral tooling; screenshots alone do not establish complete accessibility compliance.
- Direct capture of the running Codex app was blocked by the desktop safety boundary. Comparison is therefore limited to the repository's accepted Codex direction and the Rux before/after evidence captured in this run.
