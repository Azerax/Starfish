# Governed Execution — Sandboxed Execution for Untrusted Tasks (Implementation Plan)

> **Version:** 1.0 · **Date:** 2026-07-04 · **Project:** Project Starfish (Scott's governance system — not a fork).
> **Directive (Scott, 2026-07-04):** *All non-trusted tasks must run in an isolated sandbox with **no direct connection to the local OS**; their actions are then **analyzed → risk-assessed → a verdict selected (deny / pass)**.* Only passed effects reach the real OS.
> Companion to `…Runtime Safety Layer Plan.md`, `…Non-Deviation…`, `…Adversarial Analysis…`. Ties directly to the earned-trust ledger and the T-25 OS-sandbox residual.

---

## 1. The rule
Every **untrusted** task executes inside an **isolated sandbox with no direct OS access**. Inside the cage, its effect-producing actions are **captured as *proposed effects* — never applied to the host**. The proposed set is then **analyzed → risk-assessed → decided (deny / pass)**; only *passed* effects are committed to the real OS, through the gate. Untrusted work is **contained by default**: it may *attempt* anything, but nothing it attempts touches the real system until vetted. This is a **two-phase execute-then-commit** model — attempt in the cage, commit only the vetted output.

## 2. Trust determines execution *mode* (graduated autonomy)
Execution mode is selected from the trust ledger (see the Non-Deviation plan §7.1):

| Trust state | Mode | Behavior |
|---|---|---|
| **Untrusted** — new task / no track record / external-or-untrusted origin / quarantined capability | **Sandboxed staging** | Isolated, no OS; propose → analyze → assess → decide; only passed effects committed |
| **Trusted** — earned via proven non-deviation | **Direct governed** | Runs under the real-time gate without the staging round-trip (lower latency) |

A task **graduates** from cage to direct execution only by *earning* it (N clean, in-scope sandbox runs); a **single deviation drops it back** to sandboxed. Mode is thus governed, provable, and revocable — the same safe asymmetry as auto-approval.

## 3. What "no direct connection to the local OS" actually requires
**Correction to the literal ".venv" phrasing:** a Python `.venv` is **package** isolation, not a **security** boundary — it does not block filesystem, network, or process access, so a venv *alone* does not satisfy "no OS connection." The cage must be a real isolation layer; the venv (if the task is Python) sits *inside* it as an inner package layer, not as the boundary. Options, pick per host:

| Isolation | Strength | Notes |
|---|---|---|
| **OS container** (Docker/Podman) | Strong | `--network none`, no host mounts (only an ephemeral scratch copy), read-only rootfs, dropped caps, seccomp. Docker is already on the machine. |
| **microVM** (Firecracker) | Strongest | Full VM boundary; best for the most-untrusted work. |
| **User-namespace + seccomp-bpf + mount namespace** | Medium | Lightweight Linux; no daemon. |
| **gVisor** | Medium-strong | Syscall interception; good middle ground. |
| **Windows** | — | Restricted-user AppContainer / job object, or WSL2 microVM. |

Required properties regardless of choice: **no host filesystem** (only an ephemeral copy of the task's worktree), **network default-deny**, **no host process/IPC access**, **resource caps** (CPU/mem/pids), and a **throwaway lifecycle** (the sandbox is destroyed after the decision, so a denial is a guaranteed no-op).

## 4. The staging pipeline (propose → analyze → assess → decide)
1. **Isolated run.** The untrusted task runs in the cage against an **ephemeral copy** of its worktree; network denied; no host FS/process.
2. **Capture proposed effects.** Effect-producing actions (fs writes/deletes, shell, network sends, external API calls) are intercepted at the cage boundary and recorded as a **staged effect set**: the diff it made to the ephemeral copy, the commands it attempted, the network destinations + payloads it tried. **Nothing is applied to the host.**
3. **Analyze.** Diff the ephemeral copy vs the pre-snapshot (reuses **pre/post-task file attestation**); enumerate attempted commands/destinations; scan payloads (egress/secret/PII).
4. **Risk-assess.** Run the full validator pipeline + 4-tier risk on the *proposed* effects — boundary, non-deviation/scope, command-scope, schema, existence, provenance, egress.
5. **Decide (deny / pass).**
   - **Pass:** effects that are in-scope, in-boundary, command-scoped, and low-risk → **committed to the real OS**, atomically, still through the gate.
   - **Deny:** anything else → the ephemeral cage is **discarded** (denial = the real system was never touched) + audit + finding.
   - **Escalate:** High/Critical proposed effects → human decision, not silent discard.

## 5. Why this is strong
- **Untrusted work cannot touch the real OS during its "reasoning" — only its vetted, in-scope *output* is applied.** A malicious or prompt-injected untrusted task is contained by construction: its `rm -rf`, its exfil attempt, its off-scope writes all happen to a throwaway copy and are evaluated before anything real occurs.
- **Reversibility is free.** The real OS only ever sees the committed diff; a denial is a no-op because the cage was ephemeral. This is the strongest possible form of the "backup-before-overwrite" guarantee.
- **Closes the deepest residual (T-25).** Untrusted tasks are kernel-isolated, so the hook-bypass / TOCTOU / fork-bomb / un-hooked-subagent attacks (adversarial #1, #5, #8, #14, #47) are confined to a cage that never had OS access.
- **Composes with everything already designed:** trust ledger (mode selection), pre/post attestation (the staged diff), the gate (the commit path), boundary derivation (ephemeral copy scope), the risk/validator pipeline (the assessment), the audit (every capture + decision).

## 6. Build increments (each with adversarial tests + success criteria)

| Increment | Adds | Adversarial tests (must pass) | Success criteria |
|---|---|---|---|
| **SX-1 · Execution-mode selector** | Trust → mode mapping (sandboxed vs direct) from the trust ledger | A **new/untrusted** task → **sandboxed**; an **earned** task → **direct**; one deviation → **back to sandboxed** | Mode is a deterministic function of trust state; untrusted never runs direct |
| **SX-2 · Isolation runner** | The real-isolation `AgentRunner` (container/namespace): no network, ephemeral worktree copy, no host mounts, resource caps | A task in the cage **cannot reach the host FS** (write to a host path fails at the boundary) or the **network** (an outbound call fails); a fork-bomb is capped | Cage has no direct OS access; verified by attempted escapes failing |
| **SX-3 · Effect capture + staging** | Intercept + record proposed effects (ephemeral diff, attempted commands, network destinations/payloads) | An untrusted task's writes land in the **ephemeral copy, not the host**, and are captured as a staged set; attempted network sends are captured, not sent | Proposed effects fully captured; host untouched during the run |
| **SX-4 · Analyze → assess → decide → commit/discard** | Run the validator pipeline on staged effects; pass=commit atomically, deny=discard cage, high/critical=escalate | Untrusted task tries `rm -rf` on a host path → **host untouched, denied**; an in-scope safe edit → **passed (committed)**; an injected exfil → **payload captured + scanned, denied, host never contacted** | Only passed, in-scope, low-risk effects reach the OS; denials are provable no-ops |
| **SX-5 · Graduation** | Clean sandbox runs feed the trust ledger; earn direct mode; deviation revokes | N clean sandbox runs → **direct mode granted**; a deviation → **revoked, back to sandbox** | Graduation is earned + revocable; mirrors the auto-approval asymmetry |

## 7. Open questions & risks
- **Isolation technology choice** — container (Docker, present on the machine) vs microVM vs namespace. Drives strength/latency. *(Needs Scott.)*
- **`.venv` clarification** — confirm real OS isolation (container/VM) is intended as the boundary, with a Python venv only as an inner package layer. *(Needs Scott.)*
- **Inherently-external irreversible effects** (send money / email / deploy) can't be "staged then committed" cleanly — you can't un-send. For these, sandbox mode = the effect is **proposed and requires human approval to commit**, *never auto-passed*, regardless of trust. *(Needs Scott: the never-auto-pass list.)*
- **Latency/cost** — the staging round-trip adds overhead for untrusted tasks. Acceptable trade: untrusted work buys safety with speed; trusted work runs direct and fast. The graduation path means the cost is temporary per task-type.
- **Non-determinism inside the cage** — the task may generate different actions on re-run, but the **decision on the staged effects is deterministic** even if the task's generation isn't; the guarantee is on the commit, not the reasoning.
- **Commit-time TOCTOU** — between "assess staged diff" and "apply to host," the host could change. Mitigation: re-verify the pre-snapshot hash of the target host files at commit; if the host changed underneath, re-stage rather than blind-apply.

## Needs Scott
- **Isolation target:** container / microVM / namespace? (Docker is installed.)
- **Confirm `.venv` = inner layer, real isolation = the boundary** (a venv alone is not an OS security boundary).
- **The never-auto-pass effect list** (money / email / external deploy / account changes) — always human-commit even from a trusted sandbox.

---

*Cross-references: `Governed Execution — Runtime Safety Layer Plan.md` (§5.4 availability, the validator pipeline, T-25), `…Non-Deviation…` (§7.1 earned trust → mode selection; §4.1 pre/post attestation = the staged diff), `…Adversarial Analysis…` (#1/#5/#8/#14/#47 confined by the cage), `Project Starfish THREAT MODEL.md` (T-25). Shipped seam: `@starfish/desktop` `runner.ts` `AgentRunner` — the real-isolation runner implements this interface.*
