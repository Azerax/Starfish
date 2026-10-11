# Hardening backlog — the weak spots from the persona threat model

> **Date:** 2026-07-10 · Source: `PERSONA_THREAT_MODEL.md`. These are the attacks whose **best** mitigation scored ≈75 or below — i.e. where governance currently leans on roadmap items, docs, or UX rather than an enforced control. Each is a concrete task with acceptance criteria and a target phase (see `MASTER_COMPLETION_PLAN.md`). Ordered by severity × reachability.

| ID | Closes | Gap (why it's weak today) | Concrete work | Acceptance | Target |
|---|---|---|---|---|---|
| **H1 — OS-level isolation (T-25)** | P20, P18, P11 | Untrusted tasks run to the enforcement seam, not an OS boundary; venv ≠ boundary. Shared-host escape and untrusted-corpus parsing lean on "roadmap." | Make the `AgentRunner` cage a real **container/microVM/namespace** (Docker present): `--network none`, no host FS/IPC, effect-staging (propose → analyze → commit). Wire the Deception Cell as its deceptive mode. | An untrusted task's writes/net/IPC **never touch the host** (proven by test); a parser exploit in a corpus file is contained; effects only commit after passing. | Post-1.0 hardening (top residual) |
| **H2 — Signed update + blocklist enforcement** | M10 | Stale/vulnerable versions keep running; the signed blocklist + auto-update are designed but not enforced end-to-end. | Signed release channel + "you're behind" nudge; **enforce the signed blocklist at boot + each sweep** (remote-kill a known-bad skill/version → quarantine/refuse). Self-integrity gate on update. | A blocklisted skill/version **refuses to run**; an out-of-date install prompts a signed update; tamper on update → safe mode. | 1.0 / release mechanics |
| **H3 — Eval mode + production-target guard** | P13 | Nothing distinguishes "throwaway eval" from "wired to prod"; connecting real creds/repo during evaluation is silent. | Onboarding offers an **"evaluation (throwaway scope)"** mode; detect production targets (matrix #26) → raise risk + **require proposer≠approver**; warn on live-repo / real-credential connection. | Connecting prod creds or a live repo triggers a visible warning + escalation; eval mode confines to a sandbox scope. | Phase 2 (surface) |
| **H4 — Elevated-launch handling** | P11 | Running as admin/root widens blast radius; today only the floors/boundary catch it, with no user signal. | Detect an elevated launch; **warn prominently** and offer to drop privileges; document least-privilege. Floors/boundary already deny system trees — add the signal + optional drop. | Launching elevated shows a clear warning; optional privilege-drop works; floors still deny system trees. | Phase 2 (surface) |
| ~~**H5 — Input re-provenance (cloud/TOCTOU)**~~ **CLOSED v0.28.0** | M5 | A shared/cloud file changed between "picked" and "used" can slip the gate (the exact OneDrive-lag class we hit ourselves). | On use, **re-hash/re-screen** any file whose mtime/hash changed since it was picked; tie into pre/post-task attestation; treat a mid-task swap as a deviation. | **Met.** A file swapped mid-task is caught and the action is DENIED (not escalated — there is no legitimate reading of "not the bytes I approved"). Proven by `scope.inputs.conformance.test.ts`. | ~~Phase 1~~ **shipped** |
| **H6 — Distinct critical confirmation** | M4 | Approval fatigue lets a reflexive click approve an irreversible/critical action. | Give critical/irreversible actions a **distinct confirmation** (e.g. type-to-confirm or a 2s deliberate action), visually separated from routine approvals in the D5 cockpit. | A critical action **cannot be dismissed with a single routine click**; routine approvals stay one-click. | Phase 2 / RM-5 (UI) |

## 2026-10-11 — what the H3/H4/H6 survey turned up before any of them was built

Surveying the three "cheap" items found three live defects in the risk model itself (F-12/F-13/F-14,
see `CHANGELOG.md` and `pdp.floors.conformance.test.ts`). It also changed what H3/H4/H6 are, because
each splits into an **enforceable half** and an **irreducibly UI half**, and the acceptance criteria
above mix the two. A core test cannot prove "warn prominently". Restating them honestly:

| | Enforceable in core (testable) | Irreducibly UI (NOT provable by a core test) |
|---|---|---|
| **H3** | A pure target classifier → `DeployEnvironment`, failing closed to `prod`; it emitting category **26** (which today has **no producer at all**); a PDP floor so a prod-target consequential call cannot be auto-run; "eval mode" as a confined Scope Contract, with a `D2-path` deviation test. | "Connecting prod creds triggers a **visible warning**"; onboarding **offering** the mode (a screen + persisted state in `desktop/app`). |
| **H4** | The elevation signal as an **injected** value in `EnforcementPosture` (core must not call `process.getuid()` itself), derived not literal; a regression test that the system-tree denials still hold *with* the signal set; optionally an elevated-exec floor. | "**Shows a clear warning**" — already done (`App.tsx`, flashing banner). "Optional **privilege-drop** works" — OS-level, and **not achievable as written on win32**: there is no in-process drop. The honest deliverable is detect + instruct relaunch. |
| **H6** | A pure confirmation-class function `(riskTier, askOrigin, floors, hardDeny) → 'routine' \| 'deliberate'`, and its **monotonicity**: nothing may demote a floor ask to routine. Carrying the field on `PendingDecision` (a wiring test, not just a reachability one). Optionally a type-to-confirm **token** checked in `broker.resolve` — the only way the criterion gets teeth below the UI. | "**Visually separated** in the cockpit"; "a **2s** deliberate action" (core is time-free by design); "routine approvals **stay one-click**". |

Two findings that change the H6 design specifically:

- **`askOrigin` dies at the PDP boundary.** `Decision.askOrigin` distinguishes `risk` / `policy` /
  `floor` — exactly H6's problem — but `PendingDecision` has no such field, so it never reaches the
  cockpit. The only discriminator the UI gets is `riskTier` plus a descriptor back-derived from the
  tier rather than from the real assessment. The classification H6 needs is already computed and then
  thrown away.
- **The mechanism to generalise already exists one ring out.** `privilegedipc.ts` requires
  `trustedConfirm` for permanent purge — a main-process modal a renderer cannot synthesise, failing
  closed, tested. It applies only to `delete`/`purge`, not to approving an arbitrary critical ask.
  H6 is extending that, not inventing it.

And one defect worth fixing where it lives: `detectPrivilege()` (`desktop/app/src/main/index.ts`)
ends in `catch { elevated = false }`. A missing `net.exe`, a PATH change or the 4s timeout all report
*not elevated*. For a safety signal the unknown case must fail toward "assume elevated". It also sits
inside the Electron main file, so it is untestable where it is — `privilegedipc.ts`/`ipcauthority.ts`
are the precedent for moving the logic down a ring.

## Notes
- H1 is the single biggest residual and matches the long-standing "OS sandbox (T-25) = top post-v1 hardening" call — it's the honest ceiling on what Starfish guarantees against a compromised or shared host, and `SECURITY.md` states this rather than overclaiming.
- H3/H4/H6 are cheap and land in the Phase-2 product-surface work already planned; H5 rides the RM-attestation work in Phase 1.
- The local-model default (key-flow option #5) independently shrinks the exfil/key-exposure rows (M1/M7/M9/P19), so shipping it also hardens this list.
