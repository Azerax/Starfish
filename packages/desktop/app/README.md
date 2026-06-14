# @starfish/desktop-app — governed desktop (ring 3)

Electron + React shell for Project Starfish. The renderer is presentation-only: it talks to the
governed core exclusively through the preload **GovernanceBridge** (`src/preload/index.ts`) — it
reads governed views and submits action requests that the PDP adjudicates. It cannot reach Node,
the filesystem, or the governor directly.

## Run

```
cd packages/desktop/app
npm install
npm run dev        # Electron: splash window -> Bridge, governance booted fail-closed in main
# or, UI-only preview in a plain browser (uses the dev mock bridge):
npm run dev:web
```

## Layout
- `src/main/` — Electron main: boots governance (fail-closed) and the splash -> Bridge windows; IPC backs the bridge.
- `src/preload/` — exposes `window.starfish` (GovernanceBridge) over a context-isolated channel.
- `src/renderer/` — React app. `splash.html` is the loading window. `src/screens/Bridge.tsx` is the first screen.
- `src/renderer/src/theme/` — user-swappable theme packs (Fleet default, Ops neutral); palette -> CSS vars.
- `src/renderer/src/bridge/` — the contract mirror + a dev mock + `getBridge()` (real preload or mock).

The real contract of record is `packages/desktop/src/ui-contract.ts`; `bridge/types.ts` mirrors it
so the renderer builds standalone. Theme packs mirror `packages/desktop/src/theme.ts`.

> Not yet wired: main-process IPC currently returns representative DEV data; TODO markers show where
> to derive views from the live Governor (audit, tasks, services, monitor, ledgers).
