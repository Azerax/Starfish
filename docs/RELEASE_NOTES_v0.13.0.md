# Project Starfish v0.13.0 - Hardening I

First hardening pass from docs/CODE_AUDIT.md: close the normalization and defense-in-depth gaps.

## Security
- Case/Unicode-normalized boundary containment (`caseFold`/`sameOrUnder`): on case-insensitive
  filesystems (Windows/macOS) a case-varied path or denied subtree (e.g. `.STARFISH`) is now matched,
  closing the A1 boundary bypass. NFC normalization included.
- Executors re-check secret paths: `@starfish/sdk` `makeFsExecutor` and the desktop PEP deny reads/writes
  of secret files at execution, so the check no longer depends solely on the PDP (audit A4).

Verified: typecheck + dep-lint + 366 tests + CLI bundle green.
