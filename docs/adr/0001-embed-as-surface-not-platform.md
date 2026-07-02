# ADR 0001 - Embedding is a product surface ("Starfish External"), not a separate platform

- Status: Accepted
- Date: 2026-07-02
- Deciders: Scott (operator/maintainer)

## Context
Starfish today is an opinionated, all-in-one governed workspace: a desktop app (the Bridge) plus a CLI
overlay for Claude Code. A new need emerged: let people run Starfish governance inside *other* stacks -
specifically custom Claude skill packs and custom Claude UIs whose authors and users will not
re-platform. The question raised: since embedding is so different, should it be a separate platform
("Starfish External")?

Two sub-questions were separated:
1. Codebase: one engine or a second engine/repo?
2. Product/brand: one product or a distinct offering?

## Decision
One engine, one monorepo; a distinct, separately-versioned product surface named **Starfish External**.

- Codebase boundary: NO. `governance-core` is the shared trusted computing base and must stay singular.
  A forked engine would cause governance drift (the embedded Floor diverging from the app's Floor),
  which is the exact anti-feature of a governance product, and doubles maintenance for a solo team.
- Product boundary: YES. The embeddable path is its own offering with its own audience (platform
  developers and skill/UI authors, not a single operator), its own stability contract (frozen semver
  public API + wire-protocol version + long-term compat), its own risks (supply chain, multi-tenant,
  liability), and possibly its own licensing (commercial embedding).

Concretely: keep the layered packages; expose Starfish External as (a) `starfish embed` provisioning +
a loopback sidecar bundled in the CLI, and (b) optional `@starfish/sdk` / `@starfish/ui` npm add-ons.
Design the public surface as a product from day one. Reserve the "Starfish External" name and use it as
a sub-brand now; graduate to a formally separate platform only if scale + a commercial model justify it.

## Rationale
- The value proposition is that the *same vetted governance* runs everywhere; that only holds with one
  engine.
- The go-to-market wedge is zero-change governance for existing custom-Claude stacks, which favors the
  no-host-code paths (sidecar + hook overlay) over SDK import.
- Demand is expected quickly from creators shipping custom Claude skill packs / UIs (design partners and
  potential distributors via an author-bundled "Governed by Starfish").
- Solo maintainer: a second platform's docs/releases/positioning overhead is not justified pre-traction.

## Consequences
- The public embed surface is frozen + semver'd from the first release (register risk 23); a
  wire-version handshake is mandatory (14); fail-closed boot and single-writer audit travel with the
  bundle so hosts cannot ship a weakened Floor.
- Primary distribution = `starfish embed` + `starfish serve` (no host code change). `@starfish/sdk` and
  `@starfish/ui` are optional add-ons, not the main surface.
- Implementation priority shifts: bring the sidecar + generic hook overlay forward (they enable the
  zero-change wedge); SDK import is secondary.
- Licensing/brand: a "Governed by Starfish" mark + usage terms; commercial-embedding terms TBD
  (risks 68-71).
- Revisit trigger: more than one external adopter plus a commercial model -> re-evaluate a true
  platform/repo split at that point.

## Alternatives considered
- Separate platform + separate engine now: rejected (governance drift, double maintenance, premature).
- Pure npm library only (host devs import): rejected as the primary surface because the target audience
  will not modify their stack; kept as the optional `--sdk` path for Node hosts.
