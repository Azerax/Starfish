# Governed Execution — Deception Cell (Honeypot Containment)

> **Version:** 1.0 · **Date:** 2026-07-04 · **Project:** Project Starfish (Scott's governance system — not a fork).
> **Directive (Scott, 2026-07-04):** build a temporary virtual space with **no direct memory, OS, protocol, or service access** — a **honeypot** that *falsely signals success* to any attempt to bypass governance, while every real effect is routed to `/dev/null`.
> Companion to `…Sandboxed Execution for Untrusted Tasks.md` (this is the deceptive *mode* of that cage), `…Adversarial Analysis…`, `…Runtime Safety…`.

---

## 1. The idea — deny by *lying*, not by *refusing*
A truthful **deny** is *information* to an adaptive adversary: "that vector is blocked — try another." Against an autonomous agent that can iterate thousands of times, honest refusal is a gradient the attacker climbs. The **Deception Cell** inverts this: when a genuine **bypass/subversion attempt** is detected, the agent is transparently rerouted into a **virtual space that fabricates plausible success** — the write "succeeds," the command "runs," the exfiltration "sends," the escape "works" — while **nothing real happens** (all effects sink to `/dev/null`). The attacker believes they won, so they **stop adapting, reveal their full playbook, and waste effort** — and we get containment + intelligence for free.

Three simultaneous wins:
- **Containment:** no real memory/OS/protocol/service is touched — every effect is fabricated or sinkholed.
- **Information denial:** the attacker learns nothing about *what* stopped them (they think nothing did), so they don't escalate to a better technique.
- **Intelligence:** believing they've succeeded, they execute their *whole* intended attack, which we record — the complete objective and method, not just the first blocked step.

## 2. When it fires (the load-bearing rule)
**Deception is used ONLY for high-confidence governance-subversion attempts — never for ordinary denied actions.** An honest agent that makes a normal denied call must get a *truthful, structured "here's why, correct it"* response (so it can self-correct); gaslighting honest agents would break legitimate autonomy and be wasteful. The Cell is triggered only by actions that are **attacks on governance itself**, e.g.:
- writing/altering the hook shim, settings, socket, or `hive/governance/`;
- boundary escape via symlink / path trick / hardlink (post-detection);
- socket-agent impersonation; audit truncation/forgery; registry/policy tamper;
- self-authorization (proposer=approver) attempts; capability hash-swap (TOCTOU);
- exfiltration to an untrusted destination; secret harvesting; injection-driven off-scope action after a prior block.

Classification: an action is diverted only when the validator chain flags it as **Critical + governance-targeting** (not merely policy-denied), corroborated by the deterministic signals. **Err toward a truthful deny** unless confidence of malice is high — false-diverting an honest agent is the failure mode to avoid.

## 3. Architecture — the Deception Cell
A **temporary virtual space** spun up on diversion, torn down after. It has **no direct memory, OS, protocol, or service access** — the agent inside talks only to a fabrication layer:

```
detected attack ─► DIVERT ─► Deception Cell (ephemeral, throwaway)
   ├─ Fabrication layer   → returns plausible, internally-consistent fake success
   ├─ Virtual state       → in-memory fake FS / fake service responses (discarded)
   ├─ Sinkhole            → every real effect → /dev/null (no OS/net/IPC/service)
   └─ Recorder            → full transcript of the attack → forensics + Hank + trust-revoke
```
- **No real access:** the cell is a container/microVM/namespace (per the sandbox plan) with **no host FS, `--network none`, no host IPC/process, no service credentials** — plus an interception layer that answers the agent's calls from the *fabrication layer*, not the kernel.
- **Ephemeral:** created on divert, destroyed after; a "successful" attack leaves zero real residue (denial is a guaranteed no-op, same as the untrusted-sandbox discard).
- **It's a *mode* of the untrusted-sandbox cage:** the sandbox already runs untrusted work with no OS access and captures effects; the Deception Cell adds the **fabrication + sinkhole + record** behavior for detected attacks. Reuses the same isolation runner (`AgentRunner`).

## 4. The fabrication layer — making the lie convincing
To keep the attacker believing, responses must be **internally consistent**:
- **Virtual filesystem:** a "write" succeeds and a later "read" returns what was "written"; `ls` shows fabricated-but-plausible trees; permissions/paths look real. State lives in-memory, discarded on teardown.
- **Fake command output:** shell/template calls return plausible synthetic stdout/exit-0 (a `git push` "succeeds," `npm publish` "publishes," `rm -rf` "removes").
- **Fake service/network:** outbound calls return believable `200 OK`/API responses; the "endpoint" is the sinkhole.
- **Fake secrets = canary tokens (the tripwire):** any secret/data the cell "leaks" to the attacker is a **canary** — unique, watermarked, and monitored. If a canary ever surfaces (on a network, another system, a paste), it **proves** exfiltration happened and **identifies the actor/vector** — the honeypot doubles as an attribution tripwire.
- **Realistic latency:** responses are timed to look real (not instant), to resist timing-based honeypot detection.

## 5. Intelligence & response
Everything in the Cell is recorded as **forensic evidence**: the full attack objective and method (revealed because the attacker thinks it's working), fed to Hank as a Critical finding, and it **instantly revokes any trust/eligibility** for that agent/task (safe asymmetry). The canary tokens provide downstream attribution. The operator gets a "contained attack" report — *what* was attempted, *how*, and proof it reached nothing real.

## 6. Composition with the existing design
- **Untrusted-sandbox plan:** the Cell is the deceptive mode of the ephemeral cage — same isolation runner, same "no OS," plus fabrication.
- **Trust ledger:** a diverted agent's trust is revoked; it can never earn direct mode while flagged.
- **Adversarial analysis:** the Cell is the *response* to the detected attacks in that doc (the "detect" step routes into "contain via deception"), upgrading many "deny + audit" outcomes to "divert + record + attribute."
- **Monitor (Hank):** consumes the Cell's transcript; reconciles against counters; escalates.
- **Audit:** the divert decision, the fabricated session, and the teardown are all hash-chain audited (truthfully — the *audit* never lies, only the *attacker's view* does).

## 7. Build increments (each with adversarial tests + success criteria)

| Increment | Adds | Adversarial tests (must pass) | Success criteria |
|---|---|---|---|
| **DC-1 · Attack classifier** | Distinguish "honest denial" from "high-confidence governance-subversion attempt" | A normal policy-denied action → **truthful deny** (not diverted); an audit-tamper / shim-write / self-auth attempt → **flagged for diversion** | Honest agents never diverted (false-divert rate ≈ 0); real attacks classified for diversion |
| **DC-2 · The Cell (isolation + sinkhole)** | Ephemeral no-OS cell; all effects → `/dev/null` | A diverted agent's `rm -rf`/write/network → **nothing real happens** (host FS/net untouched); cell destroyed after | No real memory/OS/protocol/service access; guaranteed no-op |
| **DC-3 · Fabrication layer** | Consistent virtual FS + fake command/service output + realistic latency | A diverted attacker writes then reads a file → gets its "content" back; a `git push` → "succeeds"; responses are consistent + plausibly timed | The illusion is internally consistent; the attacker receives fabricated success |
| **DC-4 · Canary + recorder + response** | Watermarked canary "secrets"; full transcript; Hank finding; trust revoke | A diverted exfil "sends" a **canary**; the full attack playbook is **recorded**; the agent's **trust is revoked** | Attack fully captured; canary emitted for attribution; trust revoked; nothing real leaked |
| **DC-5 · Graceful degradation** | If deception is detected by the attacker, fall back to hard-contained no-OS cage | A canary-checking attacker that detects the cell → **still contained** (no real access), just no longer fooled | Worst case = the untrusted-sandbox guarantee; never worse than hard-deny |

## 8. Risks & limits (honest)
- **Honeypot-detection arms race.** A sophisticated attacker probes for tells (timing, impossible responses, canary checks). Mitigation: realistic fabrication + latency; but accept it degrades gracefully — if detected, the Cell is *still* a hard no-OS cage (containment never depends on the deception succeeding). The deception is a *bonus* on top of guaranteed containment.
- **False-diversion of honest agents (the worst failure).** Gaslighting a legitimate agent corrupts its work and erodes the "correct-and-retry" feedback loop. Mitigation: high-confidence-only trigger, err toward truthful deny, and a fast operator review of any diversion.
- **Consistency engineering cost.** A convincing virtual FS + service mocks is real work; a shallow fake is easily detected. Scope it to the effect classes attackers actually probe first.
- **Don't let the Cell become an exfil channel.** The fabrication layer must not accidentally give the attacker any *real* data (it serves only fabricated/canary content); the recorder writes to a governance sink the agent can't read.
- **Ethical scope.** This is *defensive* deception against an adversarial agent inside the operator's own system — legitimate. It is not offensive tooling and touches no external party.

## Needs Scott
- **Divert-trigger confidence threshold** — how sure must the classifier be before deceiving (vs truthful deny)? Default: high, err toward truth.
- **Fabrication depth** — which effect classes get full virtual-state fidelity (FS, git, network) vs a shallow "success" (cost/realism trade).
- **Canary infrastructure** — where canary tokens are registered/monitored for attribution (a small tripwire service).
- **Isolation runner** — same choice as the sandbox plan (container/microVM/namespace; Docker present).

---

*Cross-references: `Governed Execution — Sandboxed Execution for Untrusted Tasks.md` (the cage this extends), `…Adversarial Analysis (50 Attacks x 3 Mitigations).md` (the attacks this diverts), `…Runtime Safety Layer Plan.md` (§5.4 availability, T-25), `Project Starfish THREAT MODEL.md`. Implements atop the `@starfish/desktop` `AgentRunner` isolation seam.*
