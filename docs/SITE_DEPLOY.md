# Publishing projectstarfish.ca

The site is the `site/` folder. It is served by a Cloudflare **Worker with static assets** named
`misty-bread-80fa`, with `projectstarfish.ca` bound as a custom domain. It is not a Pages project, so
`wrangler pages ...` commands will not find it. See `wrangler.toml`.

## How it gets published

- **Automatic:** `.github/workflows/deploy-site.yml` runs on every push to `master` that changes `site/**`,
  `wrangler.toml` or the workflow itself. It checks the worker name, refuses archives, keys or other stray
  files in `site/`, deploys, and then fetches the live page to check that the committed version badge is
  being served.
- **Manual:** `Deploy-Site.ps1` runs the same three checks from a local machine. It needs a logged-in
  wrangler (`npx wrangler login`).

## What it needs

- `master` is protected. Changes go through a pull request, and the `verify` check must pass.
- The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN`, scoped to Workers Scripts: Edit on
  this account only, and `CLOUDFLARE_ACCOUNT_ID`. Until both are set, the deploy step fails after the checks.

## Status (2026-11-07)

- The live site serves the badge `v0.23 · risk model + calm UI` and 11 devlog posts. That matches `master`
  before PR #3.
- PR #3 brings 13 newer posts, including "Every yes was a security finding". It also brings the
  `deploy-site.yml` workflow and `wrangler.toml` to `master` for the first time.
- No repository secrets were set when PR #3 was opened, and the local wrangler was not logged in. So the
  site cannot be published until one of these happens:
  - Someone adds the two secrets. Merging then deploys automatically.
  - Someone runs `npx wrangler login`. Then `Deploy-Site.ps1` can publish from `master`.
- The homepage badge was changed from `v0.28 · bounded semantics` to `v0.27 · v0.28 in progress`. The old
  badge named a version that npm does not have yet; npm and `package.json` are at 0.27.0. When 0.28.0
  ships, set the badge back.
