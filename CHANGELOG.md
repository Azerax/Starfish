# Changelog

All notable changes to Project Starfish are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims at
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

_Nothing yet._

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
- Relicensed core + CLI to **Apache-2.0** (free for personal and commercial use). Trademark reserved.

### Added
- `starfish init` first-run wizard: customizable **base root** (the visibility ceiling), fail-closed
  governance seed with the scaffold tree (`tools/`, `agents/`, `skills/`, `shared/`), then launches the UI.
- Desktop packaging (electron-builder) and the projectstarfish.ca landing site.

### Fixed
- npm publish blockers (NUL-padded `package.json`); README/license metadata.

## [0.9.0] - 2026-06-15

First public release.

### Added
- `starfish govern <pack>`: the portable governance overlay - inventory, vet, risk-rate, and register a
  skill pack under deny-by-default governance.
- Single self-contained bundled CLI, installable from **npm** (`project-starfish`) and **GitHub**.
- Model-agnostic runtime spine (provider registry + adapters, deterministic audited router, dispatcher,
  host runner, agent loop) with the API key kept in the OS keychain.

## Foundation (pre-CLI, 2026-06-04 → 2026-06-15)

The trusted base, built before the CLI was packaged:
- Deny-by-default **PDP** as the single choke point; hash-chained, append-only **audit**; **boundary
  engine** (canonicalization + symlink rejection); fail-closed boot.
- Task lifecycle ("no task, no tool"), **Token Governor** (soft warn / hard pause), proposer ≠ approver.
- **Toby** (capability intake/vetting - the only door into the registry) and **Hank** (read-only runtime
  monitor reconciled against deterministic counters).
- **Evidence Gate** ("no unbacked word"), operator-signed **self-integrity** (safe mode on tamper),
  optional audit **anchoring**, **governed deletion + the Custodian** (soft, reversible, hard-rule-gated),
  **secret/.env governance** (Toby gatekept), and **external-source governance** (admit-but-taint).
- Pivot from a fork-strangler approach to a **clean-room** core; IP-safe Fleet theme.

[Unreleased]: https://github.com/Azerax/Starfish/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/Azerax/Starfish/releases/tag/v0.10.0
[0.9.3]: https://github.com/Azerax/Starfish/releases/tag/v0.9.3
[0.9.0]: https://github.com/Azerax/Starfish/releases/tag/v0.9.0
