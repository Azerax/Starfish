# Project Starfish — threat model & scope

> **The one-line frame:** Starfish provides **reasonable, advanced governance — not a guarantee against
> an operator who dismantles their own protection.** It governs the *agent* and the *content the agent
> consumes*. It assumes the operator, their machine, and their OS are trusted. Removing your own
> safeguards is not an attack Starfish defends against — it is you taking a tire off the car and then
> reporting a rough ride.
>
> This document defines **who Starfish defends against, who it does not, and why.** It is the lens every
> security decision and every audit finding is triaged through. Mature security is a *stated* boundary
> defended well — not an unbounded promise. Companion: [`SECURITY.md`](../SECURITY.md) (policy + the
> guarantees), `docs/THREAT_CLASSES_AND_MITIGATIONS.md` (per-class detail), `docs/PERSONA_THREAT_MODEL.md`.

---

## The trust ladder

Each ring trusts the ones below it. Starfish's job is the boundary between ring 1 and ring 2 — it does
not, and cannot, defend a ring against the rings beneath it.

```
ring 1  the AGENT + the CONTENT it reads        ← Starfish defends the boundary here  (IN SCOPE)
ring 2  the OPERATOR (the human running it)      ← trusted
ring 3  the OS / machine / other local processes ← trusted (with modest local-IPC hardening)
ring 4  the hardware / firmware                  ← trusted
```

**Starfish is a reference monitor between ring 1 and ring 2.** An agent is a guest inside a governance
layer that mediates every action it takes. Everything at ring 2 and below is the trusted computing base.

---

## In scope — what Starfish defends against

These are real adversaries the product exists to stop, and where a gap is a genuine finding worth fixing.

| Adversary | Example | Where it's enforced |
|---|---|---|
| **A misbehaving or hijacked agent** | an agent tries to read `~/.ssh/id_rsa`, write outside its boundary, self-approve a high-risk action, escalate its own capabilities, or exfiltrate data | PDP: boundary/secret checks, per-agent allowlist, proposer≠approver, egress guard, `no task, no tool` |
| **External / injected content** | a poisoned skill, a prompt-injection payload in a web page or a memory page, a tampered evidence store | vetting + prompt-injection screen on ingest; memory screened in *and* out; "memory content is data, never instructions, and cannot authorize a tool call" |
| **A foreign LOCAL process impersonating a governed component** | a rogue skill or unrelated malware trying to talk to the governance daemon and issue privileged calls | loopback-only sockets, bearer token, server-assigned actor identity, peer checks — the local-IPC hardening layer |
| **A remote attacker with no local access** | SSRF to `169.254.169.254` / internal services, a redirected model endpoint, a malicious source pushing "evidence" | netguard (IPv4+IPv6), source admission (deny-by-default), trust-class ceilings on evidence |
| **Tamper with governance state** | editing the audit log, stripping a capability manifest, corrupting a snapshot to erase quarantine | hash-chained audit, integrity-fails-closed, corrupt-state → safe mode, signed self-integrity manifest |

If a control that should stop one of these is fail-open, bypassable, or cosmetic, that is a bug and it
gets fixed. The bulk of the 2026-07 self-audit findings (F0–F30) are exactly these.

---

## Out of scope — the trusted computing base

These are **not** failures of Starfish. Defending them is either impossible in principle or the job of a
different layer (the OS, the hardware, the operator's own judgment). We state them plainly rather than
pretend to cover them.

- **The operator sabotaging their own copy.** Starfish is open source. Anyone can edit the code, disable
  a gate, lower a floor, or ask an agent to open a hole in their *own* installation. That is not a
  bypass — it is removing your own protection. Governance defends the operator *from the agent*, not the
  operator *from themselves*. (An organization that wants to stop *its users* from doing this uses the
  managed lockdown + OS controls; that is a deployment concern, below.)
- **A fully compromised operator machine / native code execution on the host.** If an attacker is already
  running arbitrary native code as the operator, the game is over at a layer beneath Starfish: they can
  read the keychain, keylog, and act with the operator's privileges directly. Defending the in-app
  approval dialog against someone who already owns the process is a locked screen door on a house with no
  walls. Starfish assumes the host is not already owned.
- **A renderer / browser-engine 0-day (Chromium RCE) in the desktop UI.** This is a specific case of the
  above: native code executing *inside the UI process* sits beneath every application-level control
  (CSP, bundle integrity, capability tokens all live in — and are readable from — that process). The
  desktop app reduces this surface (contextIsolation, sandbox, strict CSP, renderer-bundle integrity,
  main-owned authority, and a trusted-path OS confirmation for irreversible actions), which raises the
  bar to "RCE **plus** an OS-compositor exploit to fake a click." Closing it entirely is OS-sandbox /
  hardened-runtime territory, not application code. **Stated residual, accepted.**
- **The model provider and the network.** Starfish governs what the agent may *do* with a model's output;
  it does not vouch for the model's reasoning, and TLS/endpoint trust is the OS/CA layer's job (Starfish
  hardens the pieces it owns: keychain-stored keys, `.env` poisoning screens, endpoint-redirect blocks).
- **Third-party skills you force-approve past a warning.** Vetting quarantines medium+ risk; if you
  consent anyway, that is your risk decision, recorded in the audit.
- **Physical access, firmware, side channels.** Hardware TCB.

---

## Trust assumptions (said out loud)

1. The operator is honest **about their own machine** and does not deliberately disable their own governance.
2. The host OS is not already compromised at the native level.
3. The OS keychain / credential store is trustworthy for secret storage.
4. The hardware and firmware are trustworthy.
5. Cryptographic primitives (sha256, Ed25519) hold.

If any of these is false, Starfish's guarantees do not apply — and that is the correct, honest boundary,
not a defect.

---

## How this drives decisions

- **Findings are triaged by scope.** An in-scope gap (agent escape, injection, foreign-process
  impersonation, fail-open default) is worth fixing. Hardening *beyond* the stated out-of-scope line —
  e.g. defending the approval flow against an attacker who already has native code execution — is
  explicitly **not** pursued as if it were a failure; it is recorded as an accepted residual.
- **Defense-in-depth still applies inside the boundary.** We layer controls (token + integrity + CSP +
  trusted path) because they raise the cost of an in-scope attack and shrink the blast radius — not
  because we claim to defeat an out-of-scope one.
- **The stronger architectural boundary is a goal, not a claim.** Running governance-core in its own
  process, with the UI as an untrusted client, would move the crown jewels behind OS process isolation
  from the entire UI. It is on the roadmap; until it ships, this document states where the boundary
  actually is today.

## Deployment note — raising the trust boundary

The out-of-scope items above are scoped to the **personal / single-operator** default. An organization
that needs to defend against *its own users* (ring 2 becoming semi-trusted) raises the boundary with:
managed lockdown (`starfish install --claude-code --managed`, root-owned config), OS-level isolation
(the H1 hardening — container/microVM/namespace), and centralized audit anchoring. Those shift specific
items from "trusted" to "defended," at the cost of the deployment complexity they require. The default
posture assumes a trusted operator because that is the honest description of a personal install.
