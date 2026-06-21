# Project Starfish v0.10.0 - Govern Claude Code

Starfish can now run as a **deny-by-default governance overlay on Claude Code itself**. Every tool call is
adjudicated by a local Policy Decision Point before it runs, authorized on the way in and contained on the
way out, and written to a tamper-evident audit log. Fail-closed: if governance isn't running, governed
tool calls are denied, not allowed.

## Highlights
- **Govern an existing project in three steps**
  ```
  starfish init --overlay --yes        # seed governance under .starfish (project untouched)
  starfish install --claude-code        # wire the hooks
  starfish daemon                       # start the resident PDP; build as normal, now governed
  ```
- **Real enforcement, verified.** Reading stays allowed, edits ask for approval, writes outside the project
  or into the governance dir are denied, a benign shell command asks while `rm -rf /` is denied outright,
  and unknown tools hit default-deny. Native Claude Code tools (Read/Edit/Bash/WebFetch/…) are mapped onto
  the governed model.
- **Machine-wide lockdown (Strategy A).** `sudo starfish install --claude-code --managed` deploys a
  root-owned policy so Claude Code itself refuses competing hooks, user permission rules, and bypass mode.
  Verified against Claude Code 2.1.183.
- **`starfish doctor`** audits the whole posture (pins, absolute hook path, cli integrity, perms, daemon)
  and exits non-zero on any failure.

## Security hardening
- Absolute node + cli paths (no PATH hijack); `NODE_OPTIONS` pin + env scrub (no loader injection).
- Pinned `disableAllHooks:false` and `disableBypassPermissionsMode` in managed scope (the two switches R0
  proved are unsafe from user scope).
- Governed-projects registry (deleting `.starfish` can't silently downgrade a governed repo).
- Config-drift tripwire → daemon safe-mode (deny-all) until `starfish attest`.
- Integrity baseline + a **verify-before-exec launcher** that refuses a tampered `cli.mjs` at run time.

## Also in this release
- `BoundarySet` deny-subtrees; session-keyed PreToolUse→PostToolUse correlation; single source of truth for
  the governance seed; one-init-per-install lock.

## Upgrade note
After upgrading, re-run `sudo starfish install --claude-code --managed` to re-baseline the integrity hash
(the verify-before-exec launcher will refuse an unrecognized cli until you do).

Apache-2.0 · free for personal and commercial use. Full detail in [CHANGELOG.md](../CHANGELOG.md).
