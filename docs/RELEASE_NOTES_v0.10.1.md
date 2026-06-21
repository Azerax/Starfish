# Project Starfish v0.10.1 - Visibility, your-call friction, one-command lockdown

A usability release on top of v0.10.0's Claude Code governance. Same deny-by-default core; nicer to live with.

## Highlights
- **You can see Starfish working.** A `[Starfish]` status line shows governed state, allow/deny counts,
  daemon/safe-mode status, and your write profile - e.g. `⬡ Starfish ✓ governed · 42✓ 3⛔ · daemon up · writes:auto`.
  Every decision Claude Code surfaces is prefixed `[Starfish]` so you always know the source.
- **You choose the friction, per project.** A `writes` profile lets you pick `auto` (no prompts on
  in-project writes, with versioned backups in `.starfish/backups/`) or `ask` (prompt every write). The
  system-risk floor - writes outside the project, secrets, `.starfish`, raw shell, catastrophic commands -
  stays gated no matter what. Set it with `--writes auto|ask`, `STARFISH_WRITES`, or `--backups N`.
- **One-command lockdown.** `starfish install --claude-code --managed` now requests elevation itself: a UAC
  prompt on Windows, `sudo` on macOS/Linux. No more hunting for an admin shell. `--no-elevate` to opt out.

## Also
- Platform-aware elevation guidance (Windows has no `sudo`).
- Cross-platform tests (Windows named pipes; symlink tests skip where unsupported); the desktop app
  typechecks again; a daemon strictness bug fixed.

## Upgrade
After upgrading, re-run `starfish install --claude-code --managed` to re-baseline the integrity hash
(the verify-before-exec launcher refuses an unrecognized `cli.mjs` until you do).

Apache-2.0. Full detail: [CHANGELOG.md](../CHANGELOG.md).
