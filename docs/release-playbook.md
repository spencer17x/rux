# Rux release, rollback, and recovery playbook

更新时间：2026-08-17

## Release contract

The release workflow is tag or manual-dispatch only. It runs the full test suite first, then builds DMG/ZIP on macOS, NSIS on Windows, and AppImage/DEB on Linux. Every platform emits a versioned artifact, SHA-256 checksums, and a JSON manifest. The final `production-release` environment is an explicit approval gate; the workflow does not silently publish.

macOS packaging fails closed unless all Developer ID and App Store Connect API inputs exist. It then requires strict `codesign` verification, Gatekeeper assessment, and stapled notarization validation before artifacts reach the approval gate. Secrets are GitHub Environment/Actions secrets and must never be committed or echoed.

Required macOS secrets:

- `MACOS_CERTIFICATE_P12`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_P8`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `RUX_UPDATE_FEED_URL` — credential-free HTTPS base URL; the workflow fails closed when it is absent or unsafe.

## Version and release notes

1. Set `app/package.json` and lockfile to the intended semantic version.
2. Add a section to `CHANGELOG.md` describing user-visible changes, migrations, known limits, and recovery steps.
3. Run `npm test` and `npm run build` from `app/`.
4. For a local unsigned smoke build only, run `npm run package`. Never label that output as a public release.
5. Push an annotated `v<version>` tag or manually dispatch the workflow.
6. Review all platform manifests, checksums, signing/notarization evidence, installer smoke tests, and the generated draft release notes before approving `production-release`.

## Upgrade and rollback

Signed release builds embed a non-secret HTTPS Feed URL. Checking, downloading and installing remain explicit user actions, and installation has a second native confirmation. `electron-updater` owns staged eligibility, SHA-512 and platform signature validation. The workflow emits `latest*.yml`; publish it beside the matching signed artifacts only after production approval.

The automatic rollback path for version `X` is `${RUX_UPDATE_FEED_URL}/rollback/X`. Its metadata must resolve exactly to signed version `X`; clients reject any other downgrade. A new version is marked healthy only after the desktop/Runtime health window. Two launches without reaching that checkpoint trigger the exact-version rollback path. Pulling a bad staged release still requires a higher fixed release for clients that already confirmed health.

Before promoting a build that changes a store or Runtime protocol:

- preserve old-version fixtures and verify forward migration plus future-version refusal;
- launch the packaged previous version with an isolated data directory, populate non-sensitive fixture data, then launch the candidate against that same directory;
- verify Task/Run history, Agent Revisions, Session links and encrypted Connection metadata;
- verify the previous release refuses future stores without overwriting them;
- state whether a downgrade is supported. Never promise downgrade when a schema migration is one-way.

Rollback means withdrawing the bad artifact and republishing the last verified version plus a release note. If user data has already migrated, retain the candidate's data directory, restore only from a user-approved backup or product-provided immutable revision, and never overwrite it by launching an older binary speculatively. Provider-native Sessions are not deleted or rewritten by local rollback.

## Incident stop conditions

Do not approve a release if any signature, notarization, checksum, migration, credential-isolation, Runtime-version, installer, Terminal, or packaged click-path check is missing. Revoke or rotate exposed signing credentials immediately, remove affected artifacts, preserve logs with secrets redacted, and document impacted versions and recovery steps.

## Current external blockers

- No Apple Developer ID identity or App Store Connect notarization credentials are present in this workspace.
- Windows Credential Manager/NSIS/ConPTY and Linux Secret Service/AppImage/DEB/PTY security journeys require their target hosted runner and, for final acceptance, representative target systems.
- The Feed host and rollback metadata cannot be activated until `RUX_UPDATE_FEED_URL` and signed platform artifacts exist; unsigned QA packages intentionally show updates disabled.
