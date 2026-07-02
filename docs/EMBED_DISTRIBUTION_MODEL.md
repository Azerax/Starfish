# Embedding Distribution Model - Optional, Installed From Starfish, Run In Another Repo

> Product surface: **Starfish External** (the embeddable offering). One engine, separate product surface - see docs/adr/0001-embed-as-surface-not-platform.md and docs/STARFISH_EXTERNAL_POSITIONING.md.

Supersedes the "publish @starfish/sdk to npm for host devs to import" framing in
docs/EMBED_INTEGRATION_PLAN.md. Operator's directive: make embedding an OPTIONAL capability you install
from Starfish and then run inside another repo. This matches the existing overlay pattern
(`starfish install --claude-code`), so the engine stays bundled in the Starfish CLI and gets
provisioned into a target repo on demand.

## The model in one line
`project-starfish` (the CLI you already publish) gains a `starfish embed` command that provisions a
self-contained governance runtime into any target repo; that repo then runs `starfish serve` (a
loopback sidecar) against its own governed root. No dependency on Starfish internals is added to the
target. Optional twice over: only repos you run `embed` on get it, and Node hosts can additionally opt
into an in-process `@starfish/sdk`.

## Why this fits Starfish's existing shape
- The CLI already bundles the whole engine via esbuild (`scripts/bundle-cli.mjs`) and already
  provisions repos: `starfish init --overlay` seeds `.starfish/` into an existing repo, and
  `starfish install --claude-code` deploys an overlay. `embed` is the same move for a generic host.
- Nothing new needs to be published for the common case; the bundled sidecar serves any-language repos.

## Install flow (run once, from Starfish, targeting another repo)
```
# in (or pointed at) the target repo
starfish embed init [--dir <target>] [--dashboard] [--sdk] [--taxonomy <file>]
```
What it provisions into `<target>`:
- `.starfish/` governed root via `seedOverlay` (deny-by-default policies, audit, state, schema stamp),
  registered in the governed-projects registry. (Reuses existing code.)
- `.starfish/embed.json` - the embed config: root path, run mode(s), dashboard on/off, tool taxonomy,
  wire-version, loopback port/pipe, token file location.
- A run entry: an npm script `"govern": "starfish serve"` (or a `.starfish/run` shim) so the target
  starts governance without importing anything.
- Optional `--dashboard`: a minimal dashboard scaffold (static page using the `httpBridge`, or a
  README pointer to drop in `@starfish/ui` components).
- Optional `--sdk`: add `@starfish/sdk` to the target's devDependencies + a `governance.ts` example for
  Node hosts that want in-process governance instead of the sidecar.
The command is idempotent and refuses to clobber an existing governed root (one-init-per-install lock).

## Run flow (later, in the target repo)
- Any repo / any language: `starfish serve` starts the loopback HTTP+SSE sidecar against `.starfish`.
  The repo's skills gate themselves via `POST /v1/decide`; approvals land in the broker; the repo's own
  dashboard (or `@starfish/ui`) renders projections and drives approve/deny.
- Node repos that chose `--sdk`: `import { createGovernance } from '@starfish/sdk'` for in-process
  governance (lowest latency), same governed root and audit.
- Claude Code repos: the existing `starfish install --claude-code` overlay still applies; `embed` is the
  generic path for non-CC hosts.

## What ships where
- Engine (governance-core, hooks, sdk, sidecar): bundled inside the `project-starfish` CLI, exactly like
  the overlay is today. Installing embedding = you already have the CLI; `embed` provisions it.
- `@starfish/sdk`: published to npm ONLY as an optional in-process add-on (the `--sdk` path). Most repos
  never need it.
- `@starfish/ui`: published as an optional add-on for hosts that want the prebuilt React panels; a repo
  can instead consume the raw projections/broker API and render its own UI.
- The target repo stays clean: a `.starfish/` dir + one config + one run script. Uninstall = `starfish
  embed remove` (removes the run script + deregisters; leaves the audit unless `--purge`).

## Deltas to the existing plan
- Integration plan Section 3.1 "publish package boundaries": keep core/hooks/sdk as bundled-in-CLI;
  publish sdk + ui as OPTIONAL add-ons only. The primary distribution is `starfish embed`, not npm import.
- Implementation plan: add a command track alongside the waves:
  - Wave 1.5: `starfish embed init` / `serve` / `remove` on top of the Wave 1 SDK + Wave 2 sidecar.
  - `starfish doctor` learns an embedded-target mode (loopback-only, token perms, wire version, schema,
    deny-by-default, chain intact) so a provisioned repo can self-check.
- Wave 0 SDK (docs/WAVE0_BUILD_SPEC.md) is unchanged and still the core; the sidecar wraps it, and
  `starfish embed` provisions + launches it. The SDK simply becomes an internal building block plus an
  optional published add-on, rather than the primary product surface.

## Governance invariants (unchanged, and reinforced by this model)
Because the runtime is provisioned and bundled by Starfish rather than hand-wired by the host, the
Floor travels with it: deny-by-default seed, fail-closed boot, single audit writer, `.starfish` deny
subtree, one-init lock, schema stamp. The host cannot accidentally ship a weakened governance layer;
it gets the vetted one Starfish installs.

## One decision to confirm
Bundle mode for the target runtime:
- (A) Recommended: target uses the globally/locally installed `project-starfish` CLI (`starfish serve`);
  smallest footprint, one source of truth, easy upgrades (`npm i -g project-starfish@latest`).
- (B) Fully self-contained: `embed init` copies a pinned runtime bundle into `.starfish/runtime/` so the
  target is independent of any global install (reproducible, air-gappable) at the cost of per-repo
  duplication and manual upgrades.
Default to (A); offer (B) via `--vendored` for locked-down/air-gapped repos.
