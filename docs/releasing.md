# Rux release process

## Continuous integration

Pull requests and pushes to `main` run unit tests, TypeScript checks, Electron E2E tests, and unpacked packaging on macOS, Linux, and Windows. Matrix artifacts are retained for seven days for inspection.

## Signed macOS releases

Pushing a tag matching `v*` runs the signed macOS workflow. Configure these GitHub Actions secrets before creating a release tag:

- `MACOS_CERTIFICATE` — base64-encoded Developer ID Application certificate (`.p12`).
- `MACOS_CERTIFICATE_PASSWORD` — password for the certificate archive.
- `APPLE_ID` — Apple account used by notarytool.
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for that account.
- `APPLE_TEAM_ID` — Apple Developer team identifier.

The workflow enables hardened runtime, applies `build/entitlements.mac.plist`, signs nested native code including `node-pty`, submits artifacts for notarization, and uploads the resulting DMG/ZIP as a workflow artifact.

For a local signed build with the same environment variables:

```bash
pnpm dist:mac:signed
```

Ordinary `pnpm package` remains an unsigned local development package and does not require signing credentials.
