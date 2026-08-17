# Provider credential diagnostics desktop acceptance

Date: 2026-08-17

Artifact: isolated copy of `app/release-credentials/mac-arm64/Rux.app`, with a fresh temporary `--user-data-dir`. No user Connection, CLI login, API key, or Provider network request was used.

Verified path:

1. Opened the packaged application.
2. Opened the labelled `账户与登录` action and entered `Agent 与 Provider`.
3. Confirmed the `凭据库诊断` disclosure and `运行诊断` button were visible through accessibility state.
4. Clicked `运行诊断`.
5. Confirmed the result reported `尚未保存 Rux Native Provider 凭据`, backend `safeStorage:darwin`, and `0/0 可解密`.
6. Confirmed no migration button was offered for an empty store and no credential or network action occurred.

Evidence: `empty-store-diagnostics.png`.
