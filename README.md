# Project Starfish (monorepo)

A portable **governance overlay** for Claude builds, and the **GCS Starfish** desktop
reference app — built from one governance core under the "strangler" strategy.

> Everyone ships skills. Nobody ships governance. Starfish is the governance.

## Packages (strangler rings)

| Package | Ring | Role |
|---|---|---|
| `@starfish/governance-core` | 1 (TCB) | PDP, boundary, registries, audit, fail-closed boot. No UI, no fork imports. |
| `@starfish/governance-hooks` | 2 | PreToolUse/Stop shim + local PDP daemon — the enforcement seam. |
| `@starfish/governance-overlay` | 2 | The product: `starfish govern <pack>`. |
| `@starfish/desktop` | 3 | Project Starfish (Electron) bridge UI. |

**Layering rule (CI-enforced):** a package may import only strictly lower layers
(`core < hooks < overlay < desktop`). Governance imports nothing from transports/app.

## Develop

```
npm install
npm run ci      # typecheck + tests + conformance/determinism stubs + dep lint + IP scan + SBOM
```

## Governance

`GOVERNANCE.md` is the constitutional source of truth (framework §16); all code conforms to it.
See the planning doc set (Master Build Plan, Detailed Implementation Plan, Risk & Compliance
Registry, Threat Model, UI & Theme Spec, PRD) in the project root.
