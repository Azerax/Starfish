# Project Starfish v0.24.0 — release notes

**Date:** 2026-07-19 · **Theme:** a real audit CLI, a daemon that starts itself, and closing a command-composition gap an academic paper would otherwise have found first.

This is a smaller release than v0.23.0, sitting on top of the risk-model/Risk-Tolerance/calm-UI work. It gives an operator a first-class way to inspect the hash-chained decision log from the CLI, removes a daemon-lifecycle papercut, and fixes a genuine gap between a hardened defense that was designed and tested a month ago and the live executor that actually runs `git commit` / `run_tests` today. Full list in `CHANGELOG.md`.

## Highlights

### `starfish audit`
A read-only CLI view of the hash-chained decision log — no more reading `.starfish/audit.jsonl` by hand. `starfish audit` prints a human-readable table (newest last); `--json` emits one event per line for scripting; `--since <seq>` tails from a sequence number; `--limit <n>` caps table output (default 50); `--deny` and `--ingress` filter to denials or tool-call decisions; `--verify` walks the hash chain and exits non-zero on tamper or truncation. CLI-only change — no core or public-API-surface changes.

### Daemon auto-start
The overlay hook now starts the PDP daemon itself on the first governed tool call if it isn't already running, then re-asks — one less manual step, and fail-closed is preserved: if the daemon can't be brought up and reached, the call is **denied**, never silently allowed. Opt out with `STARFISH_NO_AUTOSTART=1` if you'd rather manage the daemon's lifecycle yourself.

### `npm run dev` from the repo root
Root `dev` / `dev:web` / `dev:setup` scripts proxy to `packages/desktop/app`, so the usual `npm run dev` works without `cd`-ing into the app package first.

### Security: T-05 command-composition gap closed
MOSAIC (arXiv:2607.02857) reports a **96.59% attack success rate** chaining individually benign CLI commands through shared OS state — no malicious instruction required, just a planted git hook or a queued `postinstall` script that a later, ordinary command silently executes. MOSAIC-Bench (arXiv:2605.03952) reports **53–86%** success across nine production coding agents from six vendors, with only **two refusals in the entire benchmark**. Five deployed defense classes — instruction scanners, capability control, information-flow tracking, command scanners, an alignment monitor — all failed against it; the strongest still let 82.57% through, because none of them reconstruct the producer/consumer relationship across separate commands.

Our own `Project Starfish THREAT MODEL.md` had independently named this exact mechanism as **T-05**, five weeks before either paper published — and the prescribed fix (`core.hooksPath=/dev/null` + `--no-verify` + a scrubbed git config for commits; invoking the test runner binary directly instead of `npm test`) was built and tested in `governance-core`'s command templates at the time. It just wasn't wired in: the live tool executor (`packages/desktop/src/peps.ts`) had its own separate, unhardened `git_commit`/`run_tests` implementation, with `run_tests` defaulting to plain `npm test` and no override anywhere in the app. Neither tool had a single test exercising it through the real executor, which is very likely why the drift went unnoticed for a month.

Both tools now route through the existing `runTemplate()` function instead of duplicating it; the `node_test` template was extended to keep the allowlisted arg-filtering `run_tests` already had. New regression tests (`peps.conformance.test.ts`) plant an actual malicious `.git/hooks/pre-commit` and an actual malicious `package.json` test script and exercise them through the real executor, not just the template in isolation.

### Docs
`USABILITYROADMAP.md` (the path to a technical creator using Starfish, M0–M6) and `DEPRECATED.md` (a deprecation ledger for the OneDrive planning folder and superseded docs) added; `docs/OVERLAY_USAGE.md` documents `starfish audit` and daemon auto-start.

## How to verify
`npm run ci` (typecheck + unit + conformance + determinism + dependency-direction lint + secret/IP scans + SBOM). Two clean runs back this release: a full gate pass — typecheck, unit, **conformance 468 (1 skipped)**, determinism, dep-lint, secret-scan, IP-scan, SBOM/license — plus a second run after the T-05 fix landed — **90 test files, 477 passed, 3 skipped** — including the new command-composition regression tests in `peps.conformance.test.ts`. Desktop app **launches** on Windows (M1).

## Honest limits (not in this release)
- **T-05's fix is scoped to git + npm.** Other ecosystems with their own hook/lifecycle-script equivalents (pip/`setup.py`, `docker build`, `make`, CI YAML) need the same audit before templates for them ship.
- **The shell-command denylist (`isCatastrophicShell`) has a small test corpus** (14 deny / 6 allow cases) relative to how creative real-world bypass techniques get — it's already architected as a fast-path pre-filter ahead of full PDP evaluation rather than the sole gate, but the corpus is worth adversarial expansion.
- **H1 — OS-level isolation (T-25) is still the single biggest residual.** Untrusted tasks run to the enforcement seam, not a real container/microVM/namespace boundary; the `AgentRunner` interface is a shipped seam, the isolation backend is still an open decision. `SECURITY.md` states this rather than overclaiming.
- Signed auto-update + blocklist enforcement (H2), an eval-mode/production-target guard (H3), and the managed-key / chat-first surfaces remain tracked in `HARDENING_BACKLOG.md` / `FEATURE_CANDIDATES.md`.

## Deferred to the owner (release mechanics)
`git commit` + push this batch (PR against `master`, required `verify` CI check); tag `v0.24.0`; `npm publish` with provenance/SBOM; independent external security review; rotate the live `.env` key.
