# Rux Repository Instructions

Rux is currently an intentionally blank desktop client. The previous product,
feature, compatibility, and parity requirements were removed in the August 2026
reset. Do not restore old modules or infer a replacement product direction until
the user supplies a new design.

## Repository shape

- `app/` contains the minimal Electron + React shell.
- The Renderer stays sandboxed and has no Node.js access.
- Keep the shell small; add dependencies and privileged boundaries only when a
  concrete new design requires them.

Run development and verification commands from `app/`:

```bash
npm install
npm run dev
npm test
npm run package
```

Preserve unrelated user changes. Do not stage, commit, or push unless explicitly
requested.
