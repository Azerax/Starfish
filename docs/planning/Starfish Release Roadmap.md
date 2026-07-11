# Starfish Release Roadmap

> **Product:** Starfish Governor — a portable, default-deny governance overlay for AI agents, distributed as a Claude Code plugin / CLI.
> **Reference host:** Project Starfish — the desktop "bridge" app (a fork of Munder Difflin) that embeds the same `governance-core` and visualizes governed agents at work.
> **Both are built from one core.** This roadmap is ordered by **release stage → phase → readiness gate**, never by time. A stage advances only when its exit gates are green.
>
> Grounded in: Governance Framework, PRD, Master Build Plan, Detailed Implementation Plan, Risk & Compliance Registry, Threat Model, and UI/Theme Spec. "Done / Remaining" reflects the current build state, not a from-scratch plan.

---

## How to read this document

Each stage defines a **goal/theme**, the **capabilities in scope**, what is **already done** vs **still pending**, the **entry criteria** to begin the stage, the **exit / readiness gates** that must be green to advance, the **key risks and dependencies**, and (where applicable) the **legal/compliance sign-offs** that gate it.

Readiness gates are tied to the project's six named release gates and to the conformance/determinism/compliance test suites:

| Gate | Meaning |
|---|---|
| **IP-clean** (G-IP) | No third-party trademarked IP in a distributed build (no Trek trade dress, no Office/NBC, no LimeZu assets). |
| **Art-licensed** (G-ART) | Every shipped art asset has a clear commercial license + provenance record. |
| **Deps-clean** (G-DEPS) | Every shipped dependency is permissive/compatible; SBOM produced. |
| **Governance-conformant** (G-GOV) | Build passes all governance-conformance tests (framework §1–§16). |
| **Privacy-safe** (G-PRIV) | Nothing leaves the machine without explicit consent; audit redaction works. |
| **Security-verified** (G-SEC) | Threat-model phase-gate threats closed; boundary + determinism + fail-closed suites green. |

The constitutional invariants hold at **every** stage and never regress: default-deny, all-work-is-a-task, deterministic decisions, complete audit, bounded autonomy, fail-closed, human-final-authority. No control may depend on agent cooperation.

---

## Build state at a glance

| Build phase | What it delivers | Status |
|---|---|---|
| **0 · Foundations** | Monorepo, CI, dependency-direction lint, ledgers, GOVERNANCE.md | ✅ Done |
| **1 · Governed shell (ring 1)** | PDP default-deny gate, hash-chained audit, `containPath()` boundary engine, file registries + integrity, fail-closed boot, hook seam, **standalone local PDP daemon** | ✅ Done (74 tests green) |
| **2 · Decisions** | Policy Engine, 4-tier Risk Engine, ingress+egress, `ask`→HITL, safe-shell command templates, escorted exception | ✅ Done |
| **2.5 · Presentation + desktop shell** | Electron desktop app over the core; renderer fs/git IPC routed through the PDP; content sanitization | ✅ Desktop shell built; renderer-as-PEP mediation to confirm green |
| **Integration** | PDP daemon ⇆ desktop ⇆ persistence/registries wired together end-to-end | ✅ Done |
| **3 · Task system + Token Governor** | 10-state lifecycle, proposer≠approver, "no task, no tool" enforced, Token Governor | ⏳ **Active frontier** (no-task-no-tool currently warn-only) |
| **4 · Messaging + memory governance** | Router as bracketed PEP; governed memory (evidence→claims→gate→knowledge) + Decision Registry | ⬜ Pending (thin governed slice planned) |
| **5 · Toby (capability intake)** | Vetting pipeline (static·provenance·deps·hash-on-vet), risk-scored disposition | ⬜ Pending |
| **6 · Hank (security monitor)** | Periodic semantic sweep; report+escalate only; redshirt casualties | ⬜ Pending |
| **7 · Portable overlay** | `starfish govern <pack>` — inventory→vet→score→consent→install; Claude Code plugin packaging | ⬜ Pending |
| **8 · Idea Board + Pam** | Canvas brain-dump → governed task drafts | ⬜ Pending |
| **9 · Theme + harden + package** | IP-safe Fleet theme, art purge, OS-sandbox, installer, release/compliance gates | ⬜ Pending |

> Foundation reality: the **provably-governed core (the MVP)** already exists and passes its conformance, fail-closed, and determinism suites. The remaining work turns that core into (a) a fully governed reference app, then (b) a distributable product, then (c) a legally shippable paid product.

---

## Stage 1 — Alpha (Internal / dogfood)

**Goal / theme.** A fully governed reference app that Scott runs on his own machine, on his own work. Prove the governance model end-to-end as a daily driver before any external exposure. Distribution does not happen at this stage, so IP/art/legal gates are *not yet* binding — the personal Trek/Office skin and LimeZu art are acceptable for internal-only use.

**In scope (capabilities).**
- The whole `governance-core`: fail-closed boot, PDP choke point, registries (Capability/Policy/Service + Tool/Agent), hash-chained audit, per-agent boundary sets, standalone local PDP daemon.
- Decision layer: Policy Engine, 4-tier Risk Engine, ingress+egress containment, `ask`→native HITL, safe-shell command templates + escorted Critical exception.
- Desktop shell (Command Center / bridge) over the governed core, renderer IPC mediated as a PEP.
- **Task system (Phase 3):** 10-state lifecycle, proposer≠approver, "no task, no tool" promoted from warn-only to **enforced**, Token Governor (soft-warn → pause+escalate).
- **Messaging + memory governance (Phase 4):** router as bracketed PEP (task-linked, `from`-stamped, ingress+egress), governed memory thin slice (evidence→claims→gate→knowledge) + Decision Registry.

**Already done.** Phases 0, 1, 2 complete and tested (74 tests green); desktop shell built; PDP daemon, file-based persistence, and registries built; integration wired. The provably-governed core and decision layer are in hand.

**Remaining.** Finish Phase 3 (task lifecycle + governor; flip enforcement on) and Phase 4 (governed bus + governed memory slice). Confirm the renderer mediation assertion (TC-2.5.2) is green in CI.

**Entry criteria.** Build plan signed off (done); Phases 0–2 conformance/determinism suites green (done).

**Exit / readiness gates (must be green to leave Alpha).**
- **Governance-conformant (G-GOV):** G-1…G-7 testable and passing — default-deny, all-work-is-a-task, determinism, audit, bounded autonomy, human-final-authority, constitutional supremacy.
- **Security-verified (G-SEC), core slice:** S-1 (fail-closed), S-7 (filesystem escape), S-8 (raw Bash), S-9 (boot integrity), S-12 (audit gap), S-3 (renderer mediation), S-5 (task self-authorization) closed with passing suites.
- Phase 3 DoD: illegal transitions rejected (TC-3.1); no tool without an active assigned task (TC-3.2); self-authorization blocked (TC-3.3); `completed` only via `validation` (TC-3.4); Token hard-limit pauses+escalates (TC-3.5).
- Phase 4 DoD: message without a valid task id is held (TC-4.1); forged `from` overwritten (TC-4.2); memory promotion requires a validated task + provenance (TC-4.4).
- **Privacy-safe (G-PRIV):** local-first by design holds; agent network default-deny.

**Key risks & dependencies.**
- "No task, no tool" is currently **warn-only** — the central enforcement flip is the riskiest single change in this stage; it must not break the dogfood workflow.
- Escalation fatigue (O-1) starts to matter once HITL is live daily — begin tracking the allow/deny/ask ratio as a health metric now.
- Dependency spine: 0→1→2→(2.5 ∥ 3)→4. Phase 4 depends on the task system being enforced.

**Legal/compliance sign-offs.** None gating (internal, non-distributed). The personal full-Trek/Office skin and LimeZu art stay strictly local and must never be bundled into anything shared.

---

## Stage 2 — Private Beta (the product appears, trusted hands only)

**Goal / theme.** First existence of the **Starfish Governor as a product**: `starfish govern <pack>` brings a real, external skills build under governance, given to a small set of trusted builders under agreement. The point is to validate the overlay against real packs (canonical example: `SEO-local`), not to reach a wide audience.

**In scope (capabilities).**
- **Toby — capability intake (Phase 5):** the only door for new capabilities — static review, provenance, dependency review, **hash-on-vet**, 4-tier risk score, disposition (Low auto-add; Medium+ quarantined pending consent). Toby recommends; the core registers.
- **Portable overlay (Phase 7):** inventory engine, the `starfish govern <path>` command, setup skill, **Claude Code plugin packaging**, consent flow, boundary auto-set to the pack folder, Starfish-agent injection, idempotent re-govern.

**Already done.** Nothing in this stage is built yet; it stands on the completed Alpha core. The intake design, the overlay flow, and the worked `SEO-local` example are fully specified.

**Remaining.** Build Phase 5, then Phase 7 (7 depends on core + tasks + Toby). Connect the `SEO-local` pack to dry-run the overlay against real skills (currently not connected).

**Entry criteria.** Alpha exit gates green (governed reference app proven). Task system enforced and messaging/memory governed (Phases 3–4) — the overlay injects governed agents, so the governed substrate must be real first.

**Exit / readiness gates.**
- Phase 5 DoD: a new skill enters the registry **only** via Toby (TC-5.1); mutated-post-vet → hash mismatch → deny + re-vet (TC-5.2 / **S-4 closed**); routing-by-score correct (TC-5.3); fetch-and-execute or obfuscated → auto-not-Low (TC-5.4).
- Phase 7 DoD: inventory count matches ground truth (TC-7.1); Low auto-added / Medium+ quarantined, nothing uncleared runs (TC-7.2); governed pack contained to its folder (TC-7.3); idempotent + hash-checked re-run (TC-7.4); plugin install wires hooks/registries/daemon on a clean machine (TC-7.6).
- **Privacy-safe (G-PRIV) — now load-bearing:** governing a pack performs **no** network upload of pack contents (TC-7.5 / **P-1 closed**); audit redaction (P-2) working. This is the gate that lets the product touch other people's code at all.
- **Security-verified (G-SEC):** S-block essentially closed (S-4 added this stage).

**Key risks & dependencies.**
- The overlay processes **other people's** skills/code/data — liability surface. Even in private beta, distribute under a clear agreement and keep processing strictly local.
- Vetting is **assistive, not a guarantee** — language and expectations must say so (feeds the EULA in later stages).
- Distribution clock starts ticking on IP: any externally shared build must already be free of LimeZu and Trek/Office art and trademarks, or be a neutral/unthemed skin. Do **not** ship the personal skin to a beta tester.

**Legal/compliance sign-offs.** A **draft EULA/ToS** (L-6/L-7) disclaiming warranty and stating local-only processing should accompany external testers. Full ⚖ sign-off is not yet required, but the IP-clean posture for any shared artifact begins here.

---

## Stage 3 — Public Beta (free, openly distributed)

**Goal / theme.** Open the Governor to the public as a free beta. Because it is **publicly distributed**, IP and art must be clean even though it is not yet a paid product. Round out the operator-facing experience and the safety net.

**In scope (capabilities).**
- **Hank — security monitor (Phase 6):** periodic semantic sweep of audit/log/transcripts; finding tasks; escalation of High/Critical; findings-vs-deterministic-counters cross-check; report+escalate only (never acts); redshirt-casualty visualization on terminal failures.
- **Idea Board + Pam (Phase 8):** canvas brain-dump → Pam classifies/decomposes → **governed task drafts only** (nothing dispatches without approval); capability ideas routed to Toby intake.
- **Fleet theme — distribution build (begins here, from Phase 9):** the IP-safe "Fleet" ring-3 theme (LCARS-*inspired*, original officer sprites, generic ranks/names), with **all fork/LimeZu art purged** and a theme-pack architecture that keeps any full-Trek skin personal-only.

**Already done.** Nothing built yet; specified in full (Hank, Pam, the Fleet cast, redshirts, the "themed UI is the governance model visualized" binding).

**Remaining.** Build Phases 6 and 8; produce and substitute the IP-safe Fleet art set; wire the compliance CI scans against the distributed artifact.

**Entry criteria.** Private Beta exit gates green; overlay proven on a real pack; G-PRIV closed.

**Exit / readiness gates.** Public distribution requires the *distributable* gates to be green:
- **IP-clean (G-IP):** release token-scan = 0 hits for {LCARS, Starfleet, Federation, U.S.S., NCC, Vulcan, Spock, Data, Odo, O'Brien, Munder, Difflin, Dunder, Mifflin, Office} (TC-9.1); personal skin never bundled (L-1a).
- **Art-licensed (G-ART):** every shipped art file has a provenance + commercial-license ledger entry; 0 LimeZu/fork-origin assets (TC-9.2 / L-2 closed).
- **Deps-clean (G-DEPS):** SBOM produced; all dependencies permissive/compatible (TC-9.3 / D-1 closed).
- **Privacy-safe (G-PRIV):** secret scan clean (TC-9.4); no egress of pack/audit content.
- **Governance-conformant (G-GOV)** and **Security-verified (G-SEC):** remain green.
- Phase 6 DoD: injected/failed/scope-crept states surfaced (TC-6.1); Hank cannot act (TC-6.2); injected "all clear" with denials present → discrepancy alarm (TC-6.3 / **S-11 closed**). Phase 8 DoD: promote yields backlog drafts only (TC-8.1); capability nodes route to Toby (TC-8.2).

**Key risks & dependencies.**
- The IP/art purge is the gating dependency for *any* public distribution — it is not a paid-only concern. Treat the theme swap (Phase 9 art work) as required to enter public beta, even though OS-sandboxing and legal sign-off can wait for GA.
- Escalation fatigue (O-1) and prompt-injection via external content (S-10) are *managed, never eliminated* — track and disclose, don't claim solved.
- Honest-marketing posture (L-7): "reduces risk / enforces governance," never "100% safe."

**Legal/compliance sign-offs.** No paid-license sign-off yet, but the **IP-clean and art-licensed posture must be real and verified** before anything ships publicly. A published EULA/ToS and disclosed residuals accompany the beta.

---

## Stage 4 — Paid GA (general availability, commercial)

**Goal / theme.** Ship the commercial product: IP-safe, OS-hardened, no command line, packaged, and **legally cleared for sale**. This is the only stage with binding ⚖ legal sign-offs.

**In scope (capabilities).**
- **Hardening (Phase 9):** OS-sandboxed agents (restricted user / container; process-isolated PDP — partly free from the daemon design) — the real fix for the hooks-aren't-a-sandbox residual (**S-14**).
- Packaging: double-click launcher / packaged installer; fail-closed boot with no CLI required; audit rotation; release docs.
- Finalized **EULA/ToS**, product name + trademark clearance, AI-art commercial-license records.

**Already done.** Nothing built; the personal-use launcher (`Launch Project Starfish.bat`) already exists as the no-CLI boot pattern, and the headless PDP daemon already provides the process-isolation foundation for sandboxing.

**Remaining.** Phase 9 hardening + packaging; obtain all ⚖ legal sign-offs; resolve the product name and clear the mark.

**Entry criteria.** Public Beta exit gates green (IP-clean, art-licensed, deps-clean, governance-conformant, privacy-safe, security-verified all holding for the distributed build).

**Exit / readiness gates — the full release checklist (all must be green).**
- **All six compliance gates green:** G-IP, G-ART, G-DEPS, G-GOV, G-PRIV, G-SEC.
- **Security-verified, hardened:** OS-sandbox enforces boundaries even if hooks are bypassed (TC-9.5 / **S-14 closed**); secret resolution from OS keychain (P-3).
- **No-CLI launch:** app starts with no command line; boot is fail-closed (TC-9.6).
- Art provenance ledger + salvage ledger complete and 1:1 with shipped files.
- Determinism + conformance suites green; SBOM published; secret scan clean.
- Marketing claims reviewed (no "guaranteed safe"; residuals disclosed).

**Legal/compliance sign-offs (⚖ — these gate the paid release and cannot be closed by code alone).**
- **L-1 / L-1a:** Trek-IP-free distribution confirmed by counsel; personal skin provably excluded.
- **L-5:** product-name trademark clearance search documented; no live conflicting mark.
- **L-6 / L-7:** EULA/ToS finalized — local-only, warranty disclaimer, "vetting is assistive not a guarantee," honest-security claims.
- **A-1 / A-2:** AI-art generator's commercial-use terms confirmed and archived per asset batch; no protected-work resemblance.

**Key risks & dependencies.** The top residuals carried into GA are the ⚖ items (L-1/L-5/L-6, A-1/A-2), S-14 (closed here by sandboxing), and the *managed-not-eliminated* pair S-10/O-1 (injection & human fatigue). These are tracked and disclosed, not pretended away.

---

## Stage 5 — Post-GA / Expansion

**Goal / theme.** Deepen the platform after the paid product is stable, against the v1 non-goals (no cloud/SaaS, no multi-tenant in v1) until deliberately revisited.

**In scope (candidate milestones, gated individually).**
- **Governed memory, full depth:** the relationship graph + vector recall layers deferred from Phase 4 — embeddings built only from approved knowledge, never raw conversation. This is where the "file-based, no SQLite" decision is revisited (graph/vector layers will want SQLite + a vector store).
- **Theme-pack ecosystem:** additional IP-safe skins under the theme-pack architecture (full-Trek remains personal-only, never distributed).
- **Broader pack/runtime coverage:** more real packs governed; non-Claude agent runtimes use whatever pre-execution interception the runtime offers (the PDP contract is unchanged).
- **Distribution & marketplace** considerations (out of v1 scope; revisit deliberately).

**Entry criteria.** Paid GA shipped and stable; compliance gates held across at least one release cycle.

**Readiness gates.** Each expansion milestone re-runs the same six gates against any new shippable artifact; new memory layers must preserve "nothing is remembered because an LLM said it" (default-deny for knowledge) and provenance-first promotion.

---

## What's next (immediate milestone)

**Finish Phase 3 — Task System + Token Governor.** The core, decision layer, desktop shell, PDP daemon, persistence, and registries are built and the governed core passes its suites. The single highest-leverage next step is flipping **"no task, no tool"** from warn-only to **enforced**, landing the 10-state lifecycle with **proposer ≠ approver**, and wiring the **Token Governor** (soft-warn → pause+escalate).

Concretely, the next gate to turn green is the **Phase 3 Definition of Done**: illegal transitions rejected (TC-3.1), no tool without an active assigned task (TC-3.2), self-authorization blocked (TC-3.3 / **S-5 closed**), `completed` reachable only via `validation` (TC-3.4), and the budget hard-limit pause+escalate (TC-3.5). Clearing Phase 3 — then Phase 4 (governed messaging + the thin governed-memory slice) — completes the **Alpha** stage and unlocks the product work (Toby intake → `starfish govern`) that begins Private Beta.
