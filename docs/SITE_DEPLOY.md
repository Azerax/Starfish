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

- Before this date the live site served the badge `v0.23 · risk model + calm UI` and 11 devlog posts.
- PR #3 added 11 posts and edited 2, including "Every yes was a security finding". It also brought the
  `deploy-site.yml` workflow and `wrangler.toml` to `master` for the first time.
- PR #3 was merged on 2026-11-07 and published by hand from `master` with `wrangler deploy` (14 files
  uploaded, worker version `7f266cc6`). The repository secrets were still not set, so the automatic
  path could not have done it.
  - The three checks were run first: worker name `misty-bread-80fa`, a clean publish root (39 files,
    no archives, keys or credential-shaped strings), and the live check afterwards.
  - `Deploy-Site.ps1` itself stopped at its first step, because a child Windows PowerShell process
    could not start `npx` on this machine. The same checks were run step by step instead.
  - The live check confirmed: the badge `v0.27 · v0.28 in progress`, 22 posts on the devlog index,
    `/blog/every-yes-was-a-finding.html` serving with its security headers, the sitemap entry, and
    404 for unknown paths.
- `deploy-site.yml` will fail at its deploy step on the next merge that changes `site/**` until both
  secrets are added. That failure does not mean the live site is out of date.
- The homepage badge was changed from `v0.28 · bounded semantics` to `v0.27 · v0.28 in progress`. The old
  badge named a version that npm does not have yet; npm and `package.json` are at 0.27.0. When 0.28.0
  ships, set the badge back.
