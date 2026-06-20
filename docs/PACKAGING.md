# Packaging GCS Starfish (the desktop UI)

The CLI (`project-starfish`) ships on npm. The **desktop app** is packaged separately into native
installers with electron-builder.

## Build installers
```bash
cd packages/desktop/app
npm install
npm run init:gov      # one-time: seed a dev governance config
npm run dist          # electron-vite build → installers in packages/desktop/app/release/
# or, unpacked for a quick local test:
npm run pack          # release/<platform>-unpacked/
```
Output (per OS): Windows **NSIS .exe** (lets the user choose the install directory), macOS **.dmg**,
Linux **AppImage**. Config: `electron-builder.yml` (appId `ca.projectstarfish.app`, productName
`GCS Starfish`).

## Letting `starfish init` launch it
`starfish init` finishes by launching the UI. It resolves the app in this order:
1. `--app <path>` flag, or the `STARFISH_APP` environment variable.
2. Conventional install locations (where the installers above place it):
   - Windows: `%LOCALAPPDATA%\Programs\GCS Starfish\GCS Starfish.exe`
   - macOS: `/Applications/GCS Starfish.app`
   - Linux: `gcs-starfish` on `PATH`, or `~/Applications/GCS Starfish*.AppImage`
3. Fallback: opens `https://projectstarfish.ca/app` in the browser.

So once a user installs the packaged app (or sets `STARFISH_APP`), `starfish init` launches it
automatically. Until then, `init` still completes setup and opens the web fallback.

## Notes
- electron-builder is invoked via `npx` (not a committed dependency) to keep installs light.
- Workspace `file:` deps are bundled by electron-vite into `out/`; if electron-builder can't resolve a
  workspace dep, run `npm install` at the repo root first so the symlinks exist.
- Code-signing (Authenticode / Apple notarization) is recommended before public distribution; add your
  certs to the electron-builder `win`/`mac` config when ready.
