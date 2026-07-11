# Changelog

All notable changes to Project Starfish are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims at
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

_Nothing yet._

## [0.23.0] - 2026-07-10

Risk model rework, a calm one-screen UI redesign, operator Risk Tolerance, and input/normalization hardening.
See `docs/RELEASE_NOTES_v0.23.0.md`.

### Added
- **Risk model (0–100 composite).** New `riskmatrix.ts` (50-category matrix, floor set, decade tier bands +
  10 human descriptors Clear→Forbidden) and `score.ts` (`assessRisk`, max-driven `composite`, `verdictFor`,
  `assessmentFromTier`) — the single, deterministic scorer. Wired into the PDP: every decision carries the
  composite; `RiskEngine.assess()` emits the full assessment. `docs/RISK_MATRIX.md`,
  `RISK_TOLERANCE_PLAN.md`, `RISK_MODEL_MIGRATION_PLAN.md`, `RISK_MODEL_ADVERSARIAL_ANALYSIS.md` (50×3).
- **Risk Tolerance setting.** Governed `RiskToleranceStore` (Low default, fail-safe-to-Low, operator-only,
  Medium double-confirm, audited, auto-revert) applied to the live PDP; persistent header chip.
- **Non-deviation.** `ScopeContractLedger` (per-task allowedTools/pathScope/commands/budget, hash-sealed,
  D1–D4 gate) wired into the PDP; input re-provenance (`attest.ts` + scope `stampInputs`/`verifyInputs`).
- **UI.** D5 "Split Cockpit" Bridge; light/dark design tokens; **Calm** neutral default (Fleet demoted to an
  optional off-by-default skin, renderer + ring-3); flashing admin/root warning banner; **Activity** screen
  for the live decision stream with an at-a-glance dashboard summary (the one-screen rule); score + descriptor
  on approval cards; neutral nav ("Skills"/"Chat"). Design records: `docs/design/UI_LINEAGE.md`,
  `UI_ONE_SCREEN.md`.
- **Skills.** 10 governed launch-skill scaffolds + `skills/starter-skills.json` + `skills/README.md`.
- **Docs.** `SECURITY.md`; `docs/comparisons/{STARFISH_VS_OPENCLAW,STARFISH_VS_HERMES}.md`;
  `PERSONAS_AND_GAPS.md`, `PERSONA_THREAT_MODEL.md` (20×3), `HARDENING_BACKLOG.md`, `FEATURE_CANDIDATES.md`,
  `MASTER_COMPLETION_PLAN.md`, `LAUNCH_READINESS_PLAN.md`, `design/RE_ARENA_ON_USE.md`.
- **Chore.** Root package tracks the release version + `scripts/sync-versions.mjs` (`npm run version:sync`);
  `.gitattributes` / `.gitignore` guards.

### Security
- **Normalize-before-match hardening.** Boundary `caseFold`/`sameOrUnder` treat `\` and `/` as equivalent on
  Windows (closes a separator-based boundary-escape) and use `/`-relative containment; `boundaryForAgent/Skill`
  forbid-checks use `sameOrUnder`. Secret-path classification defeats Windows filename tricks (NTFS ADS,
  trailing dot/space). `netguard` strips trailing FQDN dots and unwraps IPv4-mapped IPv6.

### Changed
- Every PDP `Decision` now carries an optional `score`; `DecisionLogEntry` carries `score`/`descriptor`.
- The published version is tracked from the repo root; `@starfish/*` package versions are synced (0.23.0).

## [0.22.0] - 2026-07-03

1.0 candidate: freeze, docs, compliance. (External security review + counsel-reviewed legal terms remain
owner tasks — see "Deferred" in the release notes.)

### Added
- `docs/SEMVER_AND_WIRE_COMMITMENTS.md`: the 1.0 public-API + wire-protocol freeze/deprecation policy; the
  `api-surface` and `wire-freeze` suites are named as the semver gate.
- `docs/COMPLIANCE_CONTROL_MAP.md`: mapping of Starfish's built controls to SOC 2 / ISO 27001 / EU AI Act.
- `docs/legal/TRADEMARK.md` and `docs/legal/COMMERCIAL.md` — DRAFT "Governed by Starfish" mark + no-warranty
  / commercial terms (clearly marked pending counsel review).
- `startMultiSidecar` added to the frozen public surface (1.0 commitment).

### Changed
- `docs/GA_CHECKLIST.md`: checked off the now-built items (CI provenance publish workflow, per-release SBOM,
  frozen surface + documented wire bump policy, deprecation policy, audit rotation, audit redaction).

## [0.21.0] - 2026-07-03

Provider/model expansion + cost governance.

### Security
- Capability-aware routing now FAILS CLOSED for high/critical tasks when the routed provider isn't
  registered: the dispatcher refuses rather than silently substituting the active provider, so a
  "this tier must run on provider X" intent can't be downgraded (audit A14). Low/medium tasks still
  substitute (audited) so a single-provider setup runs.

### Added
- Adapter conformance suite: every runtime adapter (anthropic/openai/google/local/router) is asserted to
  build a POST request and emit ONLY wire-safe tool names (`fs__read`, never `fs.read`) — a standing guard
  against the tool-name-400 class of breakage.
- Per-agent budget isolation test: one agent hitting its hard cap never pauses another.

## [0.20.0] - 2026-07-03

Policy authoring + governance UX.

### Added
- `starfish policy <list|explain|add|simulate>`: inspect and edit the ordered policy rules.
  `explain <subject> <action> <resource>` gives the human-readable first-match reason (or default-deny);
  `simulate` is a dry-run that shows the before/after decision for a proposed rule and flags any widening as
  `LOOSENED`; `add` appends a rule (deny-by-default floor untouched).
- Core helpers `explainPolicy`, `simulatePolicyChange`, `PolicyEngine.explain`, `savePolicies`.

### Security
- Every explanation and simulation states that the hard safety floors (out-of-boundary, secret paths,
  raw/catastrophic shell, internal-egress) are enforced separately and cannot be overridden by policy — so a
  policy edit can never silently weaken the deny-by-default floor.

## [0.19.0] - 2026-07-03

Multi-root / multi-tenant sidecar.

### Added
- `startMultiSidecar({ roots })`: one loopback sidecar governs several governed roots with hard per-root
  isolation. A token belongs to exactly one root; requests route to that root's governance/broker/audit and
  can never address or leak into another (per-root pending, audit, decision-resolved map, SSE scope). A
  duplicate token across roots is rejected at construction (embed risks #22/#39).
- Per-root operator principal sets: `RootSpec.operators` restricts who may approve.

### Security
- `DecisionBroker.resolve` takes an optional operator principal set; when supplied, the approver must be a
  designated operator, closing the gap where any non-proposer agent could approve (audit A20). Single-tenant
  `startSidecar` behavior is unchanged (operators unset).

## [0.18.0] - 2026-07-03

Live dashboard: SSE streaming.

### Added
- `GET /v1/stream` (Server-Sent Events) on the sidecar: live `hello`/`audit`/`pending`/`budgets`/`monitor`
  events. Payloads are **redacted** (audit events projected without `detail`; reason/target already
  secret-redacted) and **scoped** (a non-operator identity only sees its own actor's events + system events
  and only its own pending decisions).
- `@starfish/ui` `httpBridge.subscribe()` — SSE consumed over `fetch` so the bearer token stays in the
  Authorization header (never a query string); auto-reconnect with exponential backoff; returns an
  unsubscribe. `GovernancePanel` now updates live from the stream, with the poll kept only as a backstop.

### Changed
- `startSidecar` tracks live sockets and force-closes them on `close()` so an open SSE stream can't hang
  shutdown.

## [0.17.0] - 2026-07-03

Supply chain + release automation.

### Added
- Every internal package now declares its `@starfish/*` dependencies (hooks/overlay/desktop -> core [+ hooks];
  sdk -> core+hooks; ui dev-deps sdk for its tests).
- `scripts/secret-scan.mjs` (`npm run scan:secrets`): fails the build on committed private-key blocks or
  provider token shapes; skips test fixtures and honors an inline `secret-scan:allow` pragma.
- GitHub Actions: `ci.yml` runs the full verify gate + secret scan on every push/PR; `release.yml` publishes
  the CLI with **npm provenance** (OIDC) + an SBOM artifact on a `v*` tag (needs the `NPM_TOKEN` secret).
- Wire-protocol freeze test: `WIRE_VERSION` is pinned at 1 — the semver gate for the sidecar contract.

### Changed
- Dependency-direction lint (audit A19) auto-derives the package list from `packages/*/package.json` and now
  matches side-effect / dynamic `import()` / `require()` imports across `.ts` AND `.tsx` (previously only
  `import ... from` in `.ts`), so an upward dep can no longer slip through.

## [0.16.0] - 2026-07-03

Audit durability + truthful facts.

### Security
- Audit log survives a torn final line: `recover()` heals the partial tail and flags integrity instead of
  throwing; mid-file corruption is treated as tamper. A torn/corrupt/truncated audit now enters a
  deliberate safe-mode at boot (PDP denies all) rather than crashing (audit A16).
- Head anchor `{seq,headHash}` persisted after every append and ON BY DEFAULT, so tail
  truncation/rollback (invisible to a hash chain alone) is detected at boot (audit A17).
- Size-based audit rotation into chained segment files; `verify()` walks sealed segments then the live
  tail so the chain still verifies end to end across a reboot.
- Conservative cost accounting: when a provider returns no countable token usage, the runner substitutes a
  char/4 estimate (marked `(estimated)` in the audit) so the Token Governor still advances (audit A15).
- `run_tests` executor now allow-lists test-selection args (rejects flags / metacharacters) to stop
  runner-flag injection, and audits a failing run distinctly (deny) instead of `allow` (audit A18).

## [0.15.0] - 2026-07-03

Egress + shell containment.

### Security
- `net` egress destination guard (`isBlockedHost`): outbound governed net calls to loopback / RFC1918 /
  link-local / cloud-metadata (169.254.169.254) / `.internal` hosts are denied by default (allowlist to
  opt in), wired into the Claude Code hook seam. Closes the arbitrary-URL exfiltration channel (audit A8).
- Hardened catastrophic-shell denylist: catches flag reorder / long-form (`rm -fr /`, `rm --recursive
  --force /`), pipes to more interpreters (python/perl/ruby/node), `chmod 777` on system paths,
  `find / -delete`, `truncate ... /dev/`. Backed by a bypass-corpus test (audit A7).

## [0.14.0] - 2026-07-03

Hardening II: sidecar input validation + local trust.

### Security
- `/v1/decisions` now builds the pending record from a strict allowlist (server owns actor, kind, and a
  per-actor-namespaced refId; riskTier clamped to an enum; unknown fields ignored), closing the worker
  metadata/refId-collision spoof (audit A6).
- Request body size cap (256 KB -> 413) so a local caller cannot OOM the sidecar (audit A11).
- Host-header validation (loopback hostnames only -> 421) hardens against browser/DNS-rebind origins (A12).
- `starfish serve` writes `sidecar-tokens.json` with mode 0600 at creation; `doctor --embed` now FAILs
  (not warns) on group/world-readable token files (audit A13).

## [0.13.0] - 2026-07-03

Hardening I (from the code audit): normalization + defense-in-depth.

### Security
- Boundary containment is case- and Unicode-normalized (case-fold on Windows/macOS, NFC), closing a
  case-varied boundary/denied-subtree bypass (audit A1). New `caseFold`/`sameOrUnder` helpers + tests.
- PEP executors (`@starfish/sdk` and desktop) now re-check secret paths and deny secret reads/writes at
  execution time rather than trusting the PDP alone (audit A4).

## [0.12.0] - 2026-07-03

Starfish External: embeddable, deny-by-default governance for other stacks.

### Added
- `@starfish/sdk` (headless engine: createGovernance/governCall/runGovernedSkill, schema stamp,
  cloud-FS + root guards, pluggable taxonomy + withGovernance middleware).
- `starfish serve` loopback HTTP governance API (token auth, wire handshake, server-assigned identity,
  fail-closed) and `starfish embed [init|remove]` (provision into a target repo).
- `@starfish/ui` (httpBridge + GovernancePanel/PendingList; engine kept out of the browser bundle).
- Cross-mode conformance pack (in-process / sidecar / overlay), `skills/starfish-verify`, and a
  runnable zero-change demo.

### Security
- Audit hash-chain verified on boot; tamper -> safe mode (deny-all), fail-closed.
- Secrets redacted from audit reason/target. `starfish doctor --embed`. Frozen public API + semver guard.
  `release.ps1 -Provenance`.

## [0.11.1] - 2026-07-02

### Fixed
- Tool-schema conformance test now asserts the wire-safe tool names (`fs__write`/`fs__read`) that
  0.11.0 already sends and verifies the parser unwires them back to the governed dotted names (the
  runtime shipped correctly in 0.11.0; only the test lagged). Also restores the 0.11.0 changelog
  entry that a stale file cache dropped from the tagged commit.

## [0.11.0] - 2026-07-02

### Fixed
- **Provider tool-name 400** that blocked every model call: governed dotted tool names (`fs.read`,
  `fs.write`) are rejected by Anthropic/OpenAI/Google. Names are now mapped on the wire
  (`fs.read` <-> `fs__read`) and restored when parsing the model's tool calls, so the PDP still sees
  the governed name.
- **Approve -> re-ask loop** on file writes: the agent's tool call was flattened to `[tool_use]` in
  the transcript, so the model re-issued it after approval. Tool calls and results are now threaded
  clearly so runs complete instead of looping.
- **Relative paths denied as out-of-boundary**: the agent is now given the absolute workspace root
  and instructed to use absolute paths; the executor creates parent directories before writing.
- **Console mojibake** from a UTF-8 em dash in a `console.log` on Windows terminals.
- **False "Watcher discrepancy" alarm**: routine denials no longer trip the security-monitor ribbon;
  only genuine anomalies (boundary escapes, hash mismatches, budget-hard, orphan tool-results) do.

### Added
- **My Ready Room**: a view of "total stop" issues (missing API key, un-opted egress, hard-budget
  pause) with one-click resolve actions, a forced-but-dismissible popup, and a pulsing-red nav badge.
- **Cost governance modes**: Platform-managed (default; the provider console cap is the ceiling,
  no local budget) or an optional Starfish USD hard cap. Starfish never raises the provider's limit.
- **Remember last workspace**: the app persists and reopens the workspace it was initialized against.
- **Clear COMM approval UX**: in-flight orders show a "paused for your go/no-go" panel with inline
  Approve/Deny; results render readably and always show the stop-reason.

### Changed
- Crew **"risk" relabeled to "clearance"** (an authority/scrutiny tier, not a threat rating).
- Token Governor shows **platform-managed** instead of `$0.00 / $0.00` when no local cap is set.
- Website SEO: new `/agentic-ai-security/` and `/what-is-ai-governance/` pages (FAQ schema),
  open-source-forward home metadata, cross-links, sitemap, deferred fonts.
- Added `scripts/dev-fresh.ps1` (launch dev against the real workspace; opt-in `-Reset`).

## [0.10.1] - 2026-06-21

### Added
- **`[Starfish]` status line** for Claude Code: a persistent indicator showing governed state, allow/deny
  counts, daemon and safe-mode status, and the active `writes` profile. Every decision reason Claude Code
  surfaces is now prefixed `[Starfish]` so the source is unambiguous.
- **`writes` confirmation profile (`ask` | `auto`), per project or session.** Under `auto`, in-boundary
  file writes are auto-allowed and a versioned pre-image **backup** is kept in `.starfish/backups/`
  (recoverable). The system-risk floor (out-of-boundary, secrets, `.starfish`, raw shell, catastrophic
  commands, deletion hard-rules) is never lowerable. Set via `--writes` / `STARFISH_WRITES` / config.
- **Self-elevating managed install.** `starfish install --claude-code --managed` now requests elevation
  itself - a UAC prompt on Windows (runs in an elevated child, then returns to your terminal) or `sudo`
  on macOS/Linux. `--no-elevate` opts out.

### Changed
- Platform-aware elevation guidance (Windows has no `sudo`; the CLI and `doctor` now say the right thing).

### Fixed
- Cross-platform test portability: named pipes on Windows for the socket tests; symlink tests skip where
  the OS cannot create symlinks.
- Desktop app now typechecks (implicit-`any` regressions, `tsconfig` path mapping) and a daemon strictness bug.
- npm package metadata: corrected license (Apache-2.0), governance-focused description + keywords, modern README.

## [0.10.0] - 2026-06-21

Governing Claude Code itself: Starfish can now run as a deny-by-default overlay on a real agent.

### Added
- **Overlay enforcement for Claude Code.** New CLI commands: `starfish daemon` (resident, fail-closed
  PDP), `starfish hook --event <PreToolUse|PostToolUse|...>` (the deny-by-default shim), `starfish install
  --claude-code` (project hooks), `starfish uninstall`, `starfish attest`, and `starfish doctor`.
- **`starfish init --overlay`** seeds governance under `<project>/.starfish/` for an existing repo
  (project tree untouched) and registers it in a governed-projects registry.
- **Claude Code tool mapping.** Native CC tools (Read/Glob/Grep/LS, Write/Edit/MultiEdit/NotebookEdit,
  Bash, WebFetch/WebSearch) now map to the governed vocabulary; added `shell` and `net` governed tools and
  a catastrophic-shell denylist (`rm -rf /`, `curl | sh`, fork bombs, …) that denies outright.
- **Boundary `deny` subtrees**: an agent may write the whole project EXCEPT protected paths (e.g.
  `.starfish/`).
- **`starfish doctor`**: one command that audits the lockdown (managed pins, absolute hook command, cli
  integrity, perms, daemon status) and exits non-zero on any failure.

### Security
- **Strategy A - managed-settings lockdown** (`starfish install --claude-code --managed`): deploys a
  root-owned policy so Claude Code itself refuses competing hooks/rules/modes -
  `allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`, `strictPluginOnlyCustomization`,
  `disableBypassPermissionsMode`, and pinned `disableAllHooks:false`. **R0-verified on Claude Code 2.1.183.**
- **Hardening of the lockdown's own surface**: absolute node + cli paths (no PATH hijack), `NODE_OPTIONS`
  pin + env scrub (no loader injection), governed-projects registry (deleting `.starfish` can't downgrade
  a governed repo), config-drift tripwire → daemon safe-mode + `starfish attest`, restrictive managed-dir
  perms, an integrity baseline, and a **verify-before-exec launcher** that refuses a tampered `cli.mjs` at
  run time.

### Fixed
- Session-keyed PreToolUse→PostToolUse correlation (no more false "orphan" floods across per-call hook
  connections).

### Changed
- Single source of truth for the governance seed (`seedInstall` / `seedOverlay`); fail-closed init writes
  a one-init-per-install lock.

## [0.9.3] - 2026-06-20

### Changed
- Relicensed core + CL