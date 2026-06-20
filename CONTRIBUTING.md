# Contributing to Project Starfish

Thanks for helping build the governance layer for AI. Project Starfish is a security project — clarity
and tests matter more than speed.

## Dev setup
```bash
npm install
npm run ci    # typecheck + tests + conformance + determinism + dep-direction lint + IP scan + SBOM/licence
```
All of `npm run ci` must pass. New behavior needs **conformance tests**; governance decisions must stay
**deterministic** (same inputs + policy ⇒ same decision).

## Architecture rules (CI-enforced)
- Respect the rings: `governance-core` (1) < `governance-hooks` / `governance-overlay` (2) <
  `desktop` (3). A package may import only strictly lower layers. Governance imports nothing from
  transports or the app.
- No new third-party runtime deps in `governance-core` without discussion.
- Keep the IP-denylist clean (no upstream-fork tokens in shippable source).

## Contributor License Agreement (CLA)
By submitting a contribution (PR, patch, etc.) you agree that:

1. Your contribution is licensed to the project and its users under the **Apache License, Version 2.0**; and
2. You grant the project owner a perpetual, irrevocable, worldwide, royalty-free license to use,
   modify, sublicense, and **relicense** your contribution, including incorporating it into the
   project's **commercial / enterprise offerings**.

This lets the maintainer keep the core Apache-2.0 *and* sustain it via the commercial layer
(`COMMERCIAL.md`). You retain copyright to your contribution. If you can't agree (e.g., employer
restrictions), say so in the PR and we'll work it out.

Please also add a DCO sign-off to commits: `git commit -s` (certifies you wrote it / can submit it).

## Conduct
Be excellent to each other. Security reports: email hello@projectstarfish.ca privately, do not open a
public issue for vulnerabilities.
