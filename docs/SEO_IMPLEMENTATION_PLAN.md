# projectstarfish.ca - SEO Implementation Plan (repo-mapped)

Adapts the SEO Gap Finder plan (2026-06-22) to the ACTUAL repo. Scope: additive SEO, preserve the
technical voice + crew names, no home-copy rewrite. No em dashes (site convention).

## Repo reality (verified)
- `site/` is **pure static HTML** on Cloudflare Pages. No framework. Each `<head>` is edited directly.
- `site/index.html` = the console design, fully static (no React/bundler), inline styles + Google Fonts,
  one small inline copy script. Title today = `Project Starfish - A Governance-First, Deny-by-Default AI
  Ecosystem`; canonical present; **0 "open source" mentions**; 5 GitHub links; H1 = "Everyone ships
  skills. Nobody ships governance." with a sub-line (no keyword H2).
- Blog pages are `site/blog/*.html` sharing `site/blog/blog.css` (clean console-theme article style) with a
  sticky top nav. **New SEO pages will reuse that article style + nav for visual match.**
- URL style: blog uses `.html`. For the plan's trailing-slash canonicals, create the new pages as
  **directories with `index.html`** (`site/agentic-ai-security/index.html`) so they serve at
  `/agentic-ai-security/`. Promote `blog.css` to a shared `site/site.css` (copy) so non-blog pages can link it.

## Adjustments to the source plan
- Meta description: the source has an em dash; use " - " (site convention). Final ~200 chars, fine.
- New-page CSS: reuse the existing blog/console stylesheet (rename/copy to `site/site.css`); do NOT invent a
  new design system.
- All H3 feature claims (PDP, hash-chained audit, boundary engine, Token Governor, fail-closed boot) are
  REAL in Starfish - safe to use. Reference the crew (Oh Brian = intake/vetting, Constable Gooey = monitor,
  Quartermaster = custodian, deck crew = execution) on /agentic-ai-security/ as the separation-of-duties model.
- Keep it consistent with the npm SEO pass already shipped (same governance keyword set).

## Tasks (file-mapped, in priority order)

### Task 1 - Home head + keyword H2 [HIGHEST, ~15 min] -> `site/index.html`
1a. Title -> `Project Starfish | Open-Source AI Agent Governance Framework`
1b. Meta description -> `Everyone ships skills. Nobody ships governance. Project Starfish is an
   open-source AI governance platform for agentic systems - deny-by-default, hash-chained audit, zero trust
   for every AI agent action. Apache-2.0, local-first.`  (also update og:/twitter: title+description to match)
1c. Add an H2 immediately under the hero H1:
   `<h2>An open-source AI governance framework for agentic systems: deny-by-default policy enforcement,
    hash-chained audit trail, and zero trust for every agent action.</h2>` (styled to sit under the H1,
    muted, not competing with the marketing line).

### Task 2 - "open source" x3+ on home [~10 min] -> `site/index.html`
- Intro paragraph: add "open-source" as a modifier.
- Footer/CTA: "Apache-2.0 open source. Local-first. Fully auditable."
- A GitHub link anchor: include "source code" / "open source" (not just "GitHub").

### Task 3 - New page `/agentic-ai-security/` [HIGH, ~1-2 hr] -> `site/agentic-ai-security/index.html`
- Targets: agentic ai security (30/mo, $58 CPC), ai agents governance, ai governance tools.
- 700-1000 words, structure per source plan (problem -> PDP/audit/boundary+governor/fail-closed -> open-source
  vs commercial -> who it's for -> CTA). Reference the crew as separation of duties.
- Title `Agentic AI Security with Project Starfish | Deny-by-Default Agent Governance`; matching description;
  canonical `https://projectstarfish.ca/agentic-ai-security/`; og tags; link site.css; top nav like the blog.

### Task 4 - New page `/what-is-ai-governance/` [MED, ~45 min] -> `site/what-is-ai-governance/index.html`
- Targets: what is ai governance (90/mo, KD:6), ai governance (secondary), responsible ai governance framework.
- 600-900 words, hub/definition page per source plan. Include the FAQ JSON-LD (Task 6a). Canonical + og + nav.

### Task 5 - Internal links [~15 min]
- Home: PDP paragraph -> /agentic-ai-security/ ("agentic AI security"); a governance/audit mention ->
  /what-is-ai-governance/ ("ai governance framework"); footer -> both.
- /agentic-ai-security/: "open-source AI governance" -> home; "what is AI governance" -> /what-is-ai-governance/.
- /what-is-ai-governance/: first "Project Starfish" -> home; "agentic AI security" -> /agentic-ai-security/.

### Task 6 - Schema + technical [~20 min]
- 6a. FAQ JSON-LD in /what-is-ai-governance/ <head> (2 Q&As from source plan).
- 6b. Canonical on every new page (done in Tasks 3/4).
- 6c. Render-blocking: the only blocker is the Google Fonts CSS link. Apply the print-media swap
  (`media="print" onload="this.media='all'"`) + a `<link rel="preconnect">` (already present). The inline
  copy script is end-of-body, non-blocking.
- Add both new URLs to `site/sitemap.xml`; keep `_headers` CSP (self + inline + Google Fonts) - new pages fit it.

## Execution order
T1 (title/meta/H2) -> T2 (open source) -> T6c + sitemap (quick) -> T3 (agentic-ai-security) -> T4
(what-is-ai-governance + FAQ schema) -> T5 (internal links once both pages exist). T1 alone unlocks the
720/mo "ai governance" shot, so it ships first even if nothing else does.

## Success criteria (checklist)
- [ ] Title = "Project Starfish | Open-Source AI Agent Governance Framework"
- [ ] Meta description includes "open-source AI governance platform" + "agentic systems"
- [ ] Home H2 with "AI governance framework", "agentic systems", "deny-by-default"
- [ ] "open source" >= 3x on home
- [ ] /agentic-ai-security/ live (correct title/desc/canonical/og, on-brand, crew referenced)
- [ ] /what-is-ai-governance/ live (correct meta + FAQ schema)
- [ ] Internal links wired both directions
- [ ] Canonicals on all pages; new URLs in sitemap.xml
- [ ] Google Fonts no longer render-blocking
- [ ] No invented capabilities; no em dashes; crew names preserved

## Keyword reference (unchanged from source) - see source table; primary = "ai governance" 720/mo KD:13.
