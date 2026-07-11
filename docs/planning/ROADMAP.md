# Roadmap

Release plan for **Starfish Governor** — a portable, default-deny governance overlay for AI agents — and **Project Starfish**, its reference desktop host. Both build from one `governance-core`.

Releases are ordered by **readiness, not dates**. A release ships only when its exit criteria are green. There are no timelines in this document.

## Status legend

- ✅ Done
- 🚧 In progress
- ⬜ Planned

## Release gates

Every distributed build must pass these before it ships. They apply progressively (see each release).

| Gate | Requirement |
|------|-------------|
| IP-clean | No third-party trademarked IP (Trek, Office/NBC, LimeZu) |
| Art-licensed | Every shipped asset has a commercial license + provenance record |
| Deps-clean | All dependencies permissive/compatible; SBOM produced |
| Governance-conformant | Passes all governance-conformance tests |
| Privacy-safe | Nothing leaves the machine without consent; audit redaction works |
| Security-verified | Boundary, determinism, and fail-closed suites green |

Constitutional invariants hold in every release and never regress: default-deny, all-work-is-a-task, deterministic, fully audited, bounded autonomy, fail-closed, human-final-authority.

---

## Foundation — Governed core ✅

The provably-governed engine and decision layer. Shipped and tested.

- ✅ Monorepo, CI, dependency-direction lint, ledgers (Phase 0)
- ✅ PDP default-deny gate, hash-chained audit, boundary engine, registries, fail-closed boot, hook seam, standalone PDP daemon (Phase 1)
- ✅ Policy Engine, 4-tier Risk Engine, ingress/egress, `ask`→HITL, safe-shell templates (Phase 2)
- ✅ Desktop shell over the core; persistence; integration wired

---

## v0.x — Alpha (internal) 🚧

**Goal:** a fully governed reference app for internal dogfood. Not distributed, so IP/art/legal gates do not yet apply.

In scope:

- 🚧 Task system — 10-state lifecycle, proposer ≠ approver, "no task, no tool" enforced (currently warn-only), Token Governor (Phase 3)
- ⬜ Governed messaging — router as bracketed PEP (task-linked, `from`-stamped) (Phase 4)
- ⬜ Governed memory slice — evidence → claims → gate → knowledge + Decision Registry (Phase 4)

Exit criteria:

- [ ] Governance-conformant: all conformance tests green
- [ ] Security-verified (core): fail-closed, filesystem-escape, raw-Bash, boot-integrity, audit-gap, renderer-mediation, self-authorization suites green
- [ ] "No task, no tool" enforced, not warn-only
- [ ] Message without a valid task id is held; forged `from` overwritten
- [ ] Memory promotion requires a validated task + provenance

---

## v1.0-beta — Private Beta (the overlay) ⬜

**Goal:** first release of the product — `starfish govern <pack>` brings a real external skills build under governance. Trusted testers only, under agreement.

In scope:

- ⬜ Capability intake (Toby) — static + provenance + dependency review, hash-on-vet, risk-scored disposition (Phase 5)
- ⬜ Portable overlay — `starfish govern`, inventory → vet → score → consent → install, Claude Code plugin packaging (Phase 7)

Exit criteria:

- [ ] New capabilities enter only via the vetting pipeline; mutated-post-vet → deny + re-vet
- [ ] Low auto-added, Medium+ quarantined; nothing uncleared runs
- [ ] Governed pack contained to its folder; re-run idempotent and hash-checked
- [ ] **Privacy-safe:** no network upload of pack contents; audit redaction working
- [ ] Draft EULA/ToS (local-only, warranty disclaimer) ships with testers
- [ ] Any externally shared build is free of LimeZu/Trek/Office assets

---

## v1.0-rc — Public Beta (free) ⬜

**Goal:** open to the public at no charge. Because it is publicly distributed, IP and art must be clean even before paid release.

In scope:

- ⬜ Security monitor (Hank) — periodic semantic sweep, report + escalate only, redshirt casualties (Phase 6)
- ⬜ Idea Board + planner (Pam) — brain-dump → governed task drafts only (Phase 8)
- ⬜ IP-safe "Fleet" theme — original art, all fork/LimeZu assets purged, theme-pack architecture (from Phase 9)

Exit criteria:

- [ ] **IP-clean:** release token-scan = 0 hits; personal skin never bundled
- [ ] **Art-licensed:** every asset has a provenance + license entry; 0 fork-origin assets
- [ ] **Deps-clean:** SBOM produced; all dependencies permissive
- [ ] **Privacy-safe:** secret scan clean
- [ ] Monitor surfaces injected/failed states and cannot act on agents
- [ ] Idea Board promotion yields drafts only; nothing auto-dispatches
- [ ] Honest-marketing claims (no "guaranteed safe")

---

## v1.0 — Paid GA ⬜

**Goal:** the commercial release — IP-safe, OS-hardened, no command line, legally cleared. The only release gated by legal sign-off.

In scope:

- ⬜ OS-sandboxed agents (restricted user / container; process-isolated PDP) (Phase 9)
- ⬜ Packaged installer / double-click launcher; fail-closed boot, no CLI
- ⬜ Finalized EULA/ToS, product-name clearance, AI-art license records

Exit criteria:

- [ ] All six release gates green (IP, art, deps, governance, privacy, security)
- [ ] OS-sandbox enforces boundaries even if hooks are bypassed
- [ ] App starts with no command line; boot is fail-closed
- [ ] Provenance + salvage ledgers complete and 1:1 with shipped files
- [ ] SBOM published; secret scan clean; determinism + conformance suites green

Legal sign-offs (⚖ — cannot be closed by code):

- [ ] Trek-IP-free distribution confirmed by counsel; personal skin excluded
- [ ] Product-name trademark clearance documented
- [ ] EULA/ToS finalized (local-only, warranty disclaimer, honest claims)
- [ ] AI-art commercial-use terms confirmed and archived; no protected-work resemblance

---

## Post-GA — Expansion ⬜

Deepen the platform after GA is stable. Each milestone re-runs the six gates against any new shippable artifact. (Cloud/SaaS and multi-tenant remain out of scope until deliberately revisited.)

- ⬜ Governed memory, full depth — relationship graph + vector recall (embeddings from approved knowledge only); revisit the file-based vs SQLite decision
- ⬜ Theme-pack ecosystem — additional IP-safe skins (full-Trek skin stays personal-only)
- ⬜ Broader pack and non-Claude runtime coverage

---

## Next milestone

**Finish Phase 3 — Task System + Token Governor.** Flip "no task, no tool" from warn-only to enforced, land the 10-state lifecycle with proposer ≠ approver, and wire the Token Governor. Clearing Phase 3, then Phase 4, completes Alpha and unlocks the overlay work (intake → `starfish govern`) that opens Private Beta.
