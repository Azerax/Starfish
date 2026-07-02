# starfish-verify

Run the full Project Starfish gate (typecheck, dependency-direction lint, tests, CLI bundle) inside an
**isolated copy** of the repo, so nothing the tests do can touch the real source tree or the host's
`node_modules`.

## When to use
Before committing/pushing a wave, or any time you want a clean-room "is it green?" without polluting your
working `node_modules` (e.g. when your local install has platform-specific native binaries).

## Run
```
node skills/starfish-verify/run.mjs
```
Options: `--src <repo>` (default: this repo), `--work <dir>` (default: a temp dir), `--keep` (leave the
work dir for inspection).

## Confinement (strict access)
- The repo is copied into a work dir OUTSIDE the source; the runner refuses to proceed if the work dir is
  the source or nested in it.
- Every install/build/test write happens in the work dir only. The source tree is read, never written.
- Executing test code (untrusted-ish) runs against the copy, so it cannot escape into the real project or
  its git history.

## Exit
`0` = all gates green. Non-zero = a gate failed (its output is inline above the summary).
