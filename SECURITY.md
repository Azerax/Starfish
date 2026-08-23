# Security policy

Starfish is a governance and security product for AI agents. We hold ourselves to the standard we ask of the agents we govern.

## Reporting a vulnerability

**Please do not open a public issue for security reports.** Instead, email **security@projectstarfish.ca** (or, until that inbox is live, open a private GitHub security advisory on `Azerax/Starfish`).

Include, if you can: affected version, a description, reproduction steps or a proof of concept, and the impact you observed. We aim to acknowledge within **72 hours** and to provide a remediation timeline after triage. We support coordinated disclosure and will credit reporters who wish to be named.

Please avoid: accessing or modifying other users' data, degrading service, or running tests against machines you don't own.

## Supported versions

Starfish is in active pre-1.0 development. Security fixes target the latest published version of `project-starfish` on npm and `main` on GitHub. Older versions are not maintained.

## What our security model guarantees (and what it doesn't)

Starfish is a **deny-by-default reference monitor**: an agent is a guest inside a governance layer that mediates every action. The design intent:

- **No ungoverned action.** Every tool call is authorized (registered tool, allowed agent, in-boundary, and - when task-binding is enabled - a task-bound purpose), risk-scored, policy-checked, and audited before it runs. A call made under a task is additionally held to that task's scope contract (tools, paths, commands, budget). Task-binding is opt-in via `enforceTaskBinding`; the boot posture records which gates are actually live, so "off" is a visible fact rather than an assumption.
- **Hard floors that no setting can lift.** Filesystem boundary escape, secret-file access, catastrophic shell, and network exfiltration are enforced independently of policy or Risk Tolerance.
- **Vetting is the only door.** Skills/tools/MCPs are provenance-checked, risk-scored, and prompt-injection-screened before registration; medium+ is quarantined pending operator consent; hash-on-vet means "vetted" = these exact bytes.
- **Tamper-evident + fail-closed.** A hash-chained, append-only audit; if the log can't be written or governance is missing/corrupt, the system halts or enters safe mode.
- **Proposer ≠ approver.** No agent authorizes its own privileged action; a human is the final approver.
- **Local-first, no data egress by default.** Tainted data cannot leave to a foreign destination; API keys live in the OS keychain, never in code or `.env`.

**Who this defends (and who it doesn't).** Starfish provides **reasonable, advanced governance — not a
guarantee against an operator who dismantles their own protection.** It defends against a misbehaving or
hijacked **agent** and against **external/injected content** (poisoned skills, prompt injection, tampered
memory); it **trusts the operator, their machine, and their OS.** Editing the source to disable a gate,
or asking an agent to open a hole in your *own* install, is not a bypass — it is removing your own
safeguards. A fully compromised host (native code already executing as the operator, including a browser
0-day in the desktop UI) is beneath the layer Starfish operates at and is out of scope. The full
statement — in scope, out of scope, trust assumptions, and how a deployment raises the boundary to defend
against its own users — is in **[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)**.

**What it does not claim:** Starfish is not a sandbox escape guarantee against a fully compromised host, does not vouch for the safety of third-party skills you force-approve past a warning, and (pre-1.0) has not yet completed an independent external security review — that review is a 1.0 exit item. The governance guarantees hold to the enforcement seam (Claude Code hooks / the PDP daemon); OS-level process isolation is a planned hardening (T-25).

## Hardening you can enable

- Machine-wide managed lockdown (`starfish install --claude-code --managed`) so the governance overlay is tamper-resistant.
- Keep **Risk Tolerance** at **Low** (the default) on any machine holding data you can't lose; **Medium** is opt-in and never lifts the hard floors.
- Optional external anchoring of the audit root for institutions/auditors.

## Our own supply chain

Every release runs a self-governed CI gate: typecheck, full test + conformance + determinism suites, dependency-direction lint, a secret scan, an IP-denylist scan, and an SBOM + license check. Publishing uses npm provenance/OIDC. Starfish verifies *itself* the way it verifies skills (operator-signed self-integrity); tamper → safe mode.
