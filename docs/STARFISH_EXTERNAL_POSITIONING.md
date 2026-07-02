# Starfish External - Positioning and Go-To-Market (draft)

See ADR docs/adr/0001-embed-as-surface-not-platform.md for the product-boundary decision.

## What it is
Drop-in governance for stacks you already run. Point Starfish at an existing repo / custom Claude skill
set / custom Claude UI, and it governs every agent action deny-by-default, with a tamper-evident audit
log and a human approval loop - using the host's own CLI or UI. No re-platforming.

## The wedge: zero-change governance
The target audience will not switch tools. So the pitch is not "use our app" - it is "keep your setup,
add governance in ~10 minutes." That is why the flagship path is the sidecar + hook overlay
(`starfish embed init` then `starfish serve`), which needs no changes to the host's code; the SDK is for
those who want in-process.

## Audience
1. Authors who ship custom Claude skill packs / UIs (the design partners and distribution channel; Scott
   named creators in this space as likely early demand).
2. Their users and orgs, who want trust, auditability, and safe autonomy without changing tools.
3. Teams/enterprises under compliance pressure adopting agentic AI.

## Two distribution motions
- End-user self-install: an operator runs `starfish embed` against a stack they already use.
- Author-bundled: a skill/UI author includes Starfish and ships a "Governed by Starfish" option to their
  audience. This is the leverage play - one integration reaches a whole audience.

## First proof point (build this first)
A zero-change demo: take an existing, unmodified custom Claude skill run, put the sidecar in front of it,
and show deny-by-default + a human approval landing in the author's own UI (or the minimal dashboard),
with an audit trail. This is the Wave-2 milestone, now the flagship demo, and the artifact to show
design partners.

## Design-partner motion
- Identify 3-5 authors of custom Claude skill packs / UIs (start with the ones Scott flagged).
- Offer white-glove embedding + co-marketing; give them a "Governed by Starfish" badge and a 10-minute
  integration; feed their friction straight back into the API before it is frozen.

## Non-goals
- Not replacing anyone's tools or forcing the Bridge UI.
- Not overpromising guarantees; be explicit about scope and no-warranty (risks 68, 70).

## Risks to respect (from the register)
- Integration friction kills adoption (29, 67) - keep it truly ~10 minutes.
- Misrepresented guarantees / liability (68, 70) - clear scope + mark usage terms.
- API churn breaks embedders (23) - freeze + semver from day one, which is why partner feedback must
  come before GA.
