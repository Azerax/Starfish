# Embedding Starfish into a Host Platform - Integration Plan

> Product surface: **Starfish External** (the embeddable offering). One engine, separate product surface - see docs/adr/0001-embed-as-surface-not-platform.md and docs/STARFISH_EXTERNAL_POSITIONING.md.

Goal: make Starfish importable as a governance layer into a host that is either (a) a set of
skills run from the command line, or (b) skills fronted by a custom React dashboard. The host keeps
its own UX; Starfish provides deny-by-default enforcement, audit, boundaries, cost governance, and a
human-approval loop that the host's own dashboard can render and drive.

Scope confirmed with the operator: support all three integration modes (in-process SDK, sidecar
service, hook/middleware overlay) and all three dashboard surfaces (read-only projections,
approval/broker API, embeddable React components).

## 1. What already exists and is reusable as-is

Starfish is layered in rings; the lower rings are already host-agnostic TypeScript with no Electron
or CLI coupling.

- `@starfish/governance-core` (ring 1, pure TS): `PDP`, `Governor` (`loadGovernor`/`restoreGovernor`),
  `AuditLog` (hash-chained), `DecisionBroker` (file/list/await/resolve, proposer != approver),
  `TokenGovernor`, `containCheck`/boundaries, `CapabilityLedger` + `vet` (skill vetting),
  `SecurityMonitor`, `Dispatcher`/`ModelRouter`/`HostRunner`/`AgentLoop`, secrets/taint/anchor. This
  is the whole engine and it is already embeddable.
- `@starfish/governance-hooks` (ring 2): `handleHook`/`HookSession` (tool-call -> PDP decision) and
  `PdpDaemon` (a fail-closed server over a unix socket / named pipe).
- `@starfish/desktop` (ring 3, headless parts): `createHost` (composes a Governor + audit + state +
  a listening PDP), `projections` (`crewView`, `decisionLog`, `pendingAsView`, `budgetView`,
  `monitorView`, `serviceView`, `agentDetail`), `peps` (`makeExecutor` - boundary-checked fs/exec/git),
  and the `GovernanceBridge` UI contract (`ActionRequest`/`ActionResult`, read + action APIs).
- `packages/desktop/app` (Electron renderer): the React Bridge, Ready Room, approval queue, Token
  Governor panel, and a `getBridge()` seam that already swaps implementations (`window.starfish` vs a
  mock). This is the extraction source for embeddable components.

The important realization: the governance composition (`createHost`) and the UI contract
(`GovernanceBridge`) are already the two seams we need. The work is mostly repackaging, adding a
language-agnostic API in front of them, and generalizing the Claude-Code-specific bits.

## 2. Target architecture

Three concentric ways to consume the same engine, all sharing one `Governor` instance and one audit
log per governed root:

```
  host skill (any lang, CLI)  ─┐
  host skill (Node/TS)         ├─▶  Starfish engine (Governor + PDP + broker + audit)
  custom React dashboard       ─┘
        ▲            ▲                         │
        │            │                         ▼
   embeddable    HTTP/SSE API            governed root (.starfish):
   React comps   (loopback,              policies, audit.jsonl, state, backups
                  token-auth)
```

- In-process (Node/TS host): import the SDK, hold the `Governor` directly. Lowest latency.
- Sidecar (any language / separate process): the host talks to a local Starfish service over
  loopback HTTP + SSE. Language-agnostic, isolated, survives host restarts, fail-closed.
- Hook/middleware overlay: for hosts with a tool/skill dispatch seam, a thin adapter routes every
  tool call through the PDP deny-by-default before it runs.

All three converge on the same governed root and audit chain, so the dashboard shows one truth
regardless of how a given skill was governed.

## 3. Work items (gaps to close)

### 3.1 Publishable package boundaries
Today only the bundled CLI (`project-starfish`) is published; the rings are workspace-private.
- Publish `@starfish/governance-core` and `@starfish/governance-hooks` as public, versioned packages
  (the embeddable engine + transport).
- Extract the headless host composition out of `@starfish/desktop` into `@starfish/sdk` (no Electron
  in the dependency graph): `createGovernance({ root })` -> `{ governor, broker, executor, dispatch,
  projections }`. `@starfish/desktop` then depends on `@starfish/sdk` (keeps the Electron app working).
- Define the public API surface + semver policy and a wire-protocol version for the sidecar.

### 3.2 In-process SDK
- `createGovernance(opts)` one-call bootstrap (fail-closed): loads/creates the governed root, composes
  Governor + DecisionBroker + Security Monitor + TokenGovernor, returns typed handles.
- `runGovernedSkill({ skillId, task, tools, execute })` helper wrapping the AgentLoop + PEPs +
  resolveAsk(broker) so a Node host governs a skill in a few lines.
- `governCall(call)` primitive: a single deny-by-default PDP check + audit for hosts that just want a
  gate around their own executor.

### 3.3 Sidecar service + language-agnostic API
Extend `PdpDaemon` (or add `starfish serve`) with a loopback HTTP + SSE API, token-authenticated,
bound to 127.0.0.1 only, fail-closed. Endpoints (JSON):
- `POST /v1/decide` -> PDP decision for a proposed tool call (the CLI-skill gate).
- `POST /v1/tasks` / lifecycle (no task, no tool).
- `GET  /v1/projections/*` -> crew/decisions/budgets/monitor/agentDetail (dashboard read).
- `GET  /v1/audit?since=` -> hash-chained tail.
- `GET  /v1/pending` + `POST /v1/decisions/{id}` -> broker list + approve/deny (proposer != approver).
- `GET  /v1/stream` (SSE) -> live decisions/asks/budget events for the dashboard.
- `POST /v1/skills/vet` -> vet + register a skill into the CapabilityLedger.
A tiny language-agnostic client contract (curlable) so non-Node CLI skills can gate themselves.

### 3.4 Generic hook/middleware overlay
- Generalize `ccToGoverned` (currently Claude-Code tool names) into a pluggable `ToolTaxonomy`
  mapping so any host's tool vocabulary maps to the governed vocabulary (`fs.read`/`fs.write`/`shell`/
  `net`/...). Keep the catastrophic-shell denylist and the wire-name mapping.
- Ship a middleware shim for a skill runner: `withGovernance(runner)` that intercepts each tool call,
  calls `/v1/decide` (or the in-process PDP), and blocks/parks on deny/ask.

### 3.5 Dashboard surfaces
- Read-only projections: already functions; expose over `/v1/projections/*` + SSE (3.3).
- Approval/broker API: already `DecisionBroker`; expose over `/v1/pending` + `/v1/decisions/{id}`.
- Embeddable React components: extract the Bridge panels (crew, Ready Room, approval queue, Token
  Governor, monitor) from `packages/desktop/app` into `@starfish/ui`. They already talk through the
  `GovernanceBridge` interface via `getBridge()`; add an `httpBridge(baseUrl, token)` implementation
  so the same components render against the sidecar from any React app. Ship the theme with them.

### 3.6 Host bootstrap + skill governance
- `starfish init` for a skills repo already seeds `.starfish/` governance; document it as the host
  onboarding step.
- A host manifest (`starfish.skills.json`) listing the host's skills -> vetted into the
  CapabilityLedger (Low auto, Medium+ quarantined until operator consent), each with a boundary.
- Remember-last-workspace / single-init-lock already exist and carry over.

## 4. Governance invariants preserved across the boundary

These must hold no matter which integration mode a host uses (this is the point of the product):
- Deny-by-default: unknown tool / no allow policy -> deny or ask, never silent allow.
- Fail-closed: if the engine or sidecar is unreachable, the host's governed calls fail closed.
- proposer != approver: the API rejects a resolve whose actor proposed the decision.
- Audit is append-only + hash-chained and lives in the governed root, not the host process.
- Secrets/keys stay host-side (OS keychain); the sidecar API never returns key material; loopback +
  token auth; no key in request/log/audit.
- Boundaries and the system-risk floor (out-of-boundary, secrets, `.starfish`, catastrophic shell,
  deletion hard-rules) are non-lowerable by the host.

## 5. Phased delivery

- Phase A - SDK extraction: carve `@starfish/sdk` (`createGovernance`, `runGovernedSkill`,
  `governCall`) out of `@starfish/desktop`; publish core + hooks + sdk. Reference: a CLI skill that
  gates its own file writes in-process. (Unblocks Node/TS hosts immediately.)
- Phase B - Sidecar API: `starfish serve` with the loopback HTTP + SSE endpoints (3.3) + a curlable
  client. Reference: a non-Node CLI skill gating via `/v1/decide`, approvals landing in the broker.
- Phase C - Embeddable UI: extract `@starfish/ui` + `httpBridge`; a sample custom React dashboard
  that renders live projections and drives approvals against the sidecar.
- Phase D - Overlay generalization: pluggable `ToolTaxonomy` + `withGovernance` middleware for a
  generic skill runner; host manifest vetting flow.
- Phase E - Hardening + docs: API auth/threat model, wire-version compatibility, semver of the public
  surface, an integration guide per host type, conformance tests across all three modes.

## 6. Open decisions
- Sidecar transport: HTTP+SSE (simplest, curlable, language-agnostic) vs. extend the existing socket
  protocol. Recommendation: HTTP+SSE on loopback for reach; keep the socket for the CC hook path.
- Auth: local bearer token in a `0600` file under the governed root, handed to the host out-of-band.
- Multi-tenant: one Governor per governed root; a host with many skill repos runs one sidecar per
  root (or a root-routing front). Decide before Phase B.
- Package naming: `@starfish/sdk` + `@starfish/ui`, or fold the SDK into `@starfish/governance-core`.

## 7. Fastest path to a working demo
Phase A + a slice of B: publish core/hooks/sdk, stand up `POST /v1/decide` + `GET /v1/pending` +
`POST /v1/decisions/{id}`, and have one CLI skill call the gate and block on approval. That proves the
whole loop (host action -> deny-by-default -> human approve -> execute -> audit) with the host's own
front end, and everything else layers onto it.
