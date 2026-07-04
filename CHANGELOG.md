# Changelog

All notable changes to Project Starfish are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims at
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

_Nothing yet._

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