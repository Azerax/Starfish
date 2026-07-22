# Project Starfish — Roadmap

> **Current release: v0.24.0.** Pre-1.0. Sequenced by dependency, not by date — no ship dates are
> promised here, and nothing on this page lowers the deny-by-default / fail-closed floor.
>
> Track progress on the [milestones](https://github.com/Azerax/Starfish/milestones).

Starfish is a governance layer for AI agents: every tool call is authorized by one deny-by-default
policy decision point, contained to a boundary, and written to a hash-chained audit log. There are two
things being built on that core:

- **The overlay** — `starfish govern` wraps an existing agent build (verified against Claude Code) so
  its tool calls hit the Starfish PDP. Works today.
- **GCS Starfish** — an Electron desktop app for driving and watching governed agents. In progress.

---

## Shipped

| Version | What landed |
|---|---|
| **v0.24.0** | **Memory Wiki Phase 1** — linked evidence wiki, governed read path, robust confidence aggregation. **T-05 command-composition fix** — `git_commit` / `run_tests` routed through hardened templates. `starfish audit` read-only chain viewer. Daemon auto-start (fail-closed). |
| **v0.23.0** | 0–100 composite risk model + Risk Tolerance store. Scope-contract non-deviation. Split Cockpit UI + Calm default theme. Windows path-separator boundary hardening. |
| **v0.22.0** | 1.0-candidate freeze: wire protocol + public API surface locked behind semver gates; compliance control mappings. |
| **v0.19–0.21** | Multi-root sidecar, policy authoring (`starfish policy`), provider expansion + cost governance. |
| **v0.13–0.18** | The hardening core: path canonicalization, sidecar input validation, egress + shell containment, audit durability, supply-chain + release automation, SSE dashboard streaming. |

Detail per release is in [`CHANGELOG.md`](CHANGELOG.md). The historical v0.13→v0.22 plan has been
retired now that it is fully consumed.

---

## In progress

The near-term path is getting a technical user from install to **creating** under governance. Ordered
by dependency; each milestone is only reachable once the one before it lands.

| | Milestone | Goal | Status |
|---|---|---|---|
| **M0** | Publishable & self-starting | `npm i -g project-starfish` → govern a real Claude Code project, no daemon babysitting | Mostly done — daemon auto-start and `starfish audit` shipped; npm publish + an end-to-end proof capture remain |
| **M1** | The app boots on the real governor | Desktop app launches showing live governor state, not mocks | ✅ Done |
| **M2** | Human-in-the-loop control | Operator Approve / Deny / Resume actually moves an agent | Built; runtime behaviour unverified |
| **M3** | Dispatch — talk to it and it runs | Type a brief → a governed agent runs it with a real model call | Built; **this is the next open gate** |
| **M4** | Real tools / self-hosting | The agent produces real files and code, every tool call gated and evidence-checked | Built; runtime behaviour unverified |
| **M5** | Creator ergonomics | First governed creation in under 15 minutes without reading source | Partly shipped via the v0.23 risk-tolerance work |
| **M6** | Packaged + distributable | Install a signed build and create, no clone or dev server | Blocked on signing certificates |

M2–M4 are constructed but not yet proven at runtime. The honest next question is behavioural, not
architectural: *does typing a brief actually dispatch a governed run that produces an artifact?*

---

## Toward 1.0

1.0 is a commitment to a frozen wire protocol and public API, not a feature count. Remaining:

- **Supply-chain posture** — OpenSSF Scorecard is currently **3.7/10**. Workflow hardening (least-privilege
  `GITHUB_TOKEN`, SHA-pinned actions, Dependabot) and dependency-vulnerability triage are planned.
- **Memory Wiki Phase 2** — the Thucydides analyst mode and local embeddings built only from approved
  pages. Phase 3 (SQLite/graph store, vector recall) is deferred until the file-based graph strains.
- **External security review** before the 1.0 freeze.
- **Signed release channel** with blocklist enforcement (see H2 below).

---

## Hardening backlog

Security work that is committed but not yet enforced end to end. These are the attacks whose best
current mitigation leans on roadmap items, docs, or UX rather than an enforced control — published
deliberately, because a governance product that hides its own residuals is not credible.

| ID | Gap | Target |
|---|---|---|
| **H1** | **OS-level isolation.** Untrusted tasks run to the enforcement seam, not an OS boundary. This is the honest ceiling on what Starfish guarantees against a compromised or shared host. | Post-1.0, top residual |
| **H2** | Signed update + blocklist enforcement — a known-bad skill/version should refuse to run. | 1.0 / release mechanics |
| **H3** | Eval mode + production-target guard — nothing currently distinguishes a throwaway evaluation from a live production wiring. | Phase 2 |
| **H4** | Elevated-launch handling — running as admin/root widens blast radius with no user signal. | Phase 2 |
| **H5** | Input re-provenance — a shared/cloud file changed between "picked" and "used". | Phase 1 |
| **H6** | Distinct critical confirmation — approval fatigue lets a reflexive click approve an irreversible action. | Phase 2 / UI |

Full detail and acceptance criteria: [`docs/HARDENING_BACKLOG.md`](docs/HARDENING_BACKLOG.md).
Known residuals are also stated in [`SECURITY.md`](SECURITY.md) rather than overclaimed.

---

## Not commitments

Ideas we intend to build *eventually* but have not committed to a release live in
[`docs/FEATURE_CANDIDATES.md`](docs/FEATURE_CANDIDATES.md) — each with an explicit promotion criterion
that graduates it onto this page. Among them: the Arena trust-proving ground, the Deception Cell,
agent-authored skills, and a managed key tier.

A candidate is not a promise. Keeping the two lists separate is the point.

---

## How this page is maintained

One source of truth per topic:

- **This file** — the committed, public roadmap.
- **[`docs/HARDENING_BACKLOG.md`](docs/HARDENING_BACKLOG.md)** — committed security work, with acceptance criteria.
- **[`docs/FEATURE_CANDIDATES.md`](docs/FEATURE_CANDIDATES.md)** — uncommitted ideas with promotion criteria.
- **[`docs/EVIDENCE_BACKLOG.md`](docs/EVIDENCE_BACKLOG.md)** — claims we believe but have not captured
  evidence for. Nothing moves from there into public copy until it is proven or withdrawn.
- **[`CHANGELOG.md`](CHANGELOG.md)** — what actually shipped.

Roadmap is directional and will be reordered if a real user needs a capability sooner. Issues and
milestones on this repo are the live view; this page is the narrative one.
