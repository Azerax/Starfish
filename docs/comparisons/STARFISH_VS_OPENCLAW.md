# Starfish vs OpenClaw

> **TL;DR:** OpenClaw proved that a local, autonomous AI agent could do real work for real people — and it brought millions into agentic AI. Starfish keeps that capability and adds the one thing an agent with access to your files, shell, and network needs: **governance that loads first and can't be turned off.** Everything OpenClaw does, without the ways it gets you breached.

## Credit where it's due

OpenClaw did the hardest thing in software: it made agentic AI *real and accessible* to millions and lit up a generation of builders. This page isn't a takedown. It's an argument that the movement OpenClaw started can only scale if the agent is governed — and that governing it shouldn't cost you the capability that made it worth running.

## What they share (the capability bar)

| Capability | OpenClaw | Starfish |
|---|---|---|
| Runs locally, connects an LLM to your machine | ✅ | ✅ |
| Files, shell, network, apps | ✅ | ✅ (each gated + audited) |
| Persistent memory across sessions | ✅ | ✅ (governed: evidence → approved knowledge) |
| Works tasks in the background | ✅ | ✅ (governed scheduled tasks, re-scored at run time) |
| Skills / extensibility | ✅ (ClawHub marketplace) | ✅ (vetted built-ins + `starfish govern` for the rest) |
| Model-agnostic (bring your own) | ✅ | ✅ |
| Chat-driven | ✅ (messaging apps) | ▲ desktop cockpit today; chat surface + connectors on the roadmap |

## Where they differ: governance is the product

OpenClaw's design gives the agent authority and trusts it to behave. Starfish inverts that — **the agent is a guest inside a governance layer that mediates every action**:

- **Deny-by-default.** No tool runs unless it's registered, allowed for that agent, tied to a task, inside the agent's boundary, and passes risk + policy. *No task, no tool.*
- **Vetting is the only door.** Skills are provenance-checked, risk-scored, and prompt-injection-screened before they can run; medium+ is quarantined pending your consent. There is no "just install this."
- **Hash-chained audit, audit-before-act.** Every meaningful action is recorded to an append-only log; if the log can't be written, nothing runs.
- **Hard floors that a setting can't lift.** Filesystem boundary, secrets, catastrophic shell, and network exfiltration are enforced independently of any tolerance or policy.
- **Proposer ≠ approver.** An agent can never authorize its own privileged action.
- **Fail-closed.** Missing or tampered governance halts startup or enters safe mode.

## The security delta, mapped to real incidents

OpenClaw's launch surfaced exactly the failure modes Starfish is built to prevent. This isn't hypothetical — each maps to a shipped control:

| OpenClaw incident (2025–26) | What happened | Starfish control that addresses it |
|---|---|---|
| **ClawBleed** (CVE-2026-25253) | one clicked link → full RCE; ~40k instances exposed, 63% exploitable | no ungoverned exec path; command-templates only, raw shell never allowlisted; links/content are untrusted data, never instructions |
| **Malicious marketplace skills** (~1,184 on ClawHub) | trojaned skills installed and ran | vetting-is-the-only-door: provenance + static + injection screen + hash-on-vet before a skill can run; a curated, signed built-in set |
| **Flawed skills** (~37% carried a security flaw) | vulnerable skills shipped freely | risk-scored intake; medium+ quarantined; hard floors bound the blast radius even for a flawed skill |
| **Exposed MCP servers** (~492 with zero auth) | agent endpoints open to the internet | external sources deny-by-default + tainted; egress guard blocks internal/foreign destinations |
| **Shadow installs** (one-line, no approval, no visibility) | agents deployed with no review or audit | governed install + hash-chained audit; nothing runs ungoverned or unseen |

## Honest tradeoffs

- **Starfish asks you sometimes.** Deny-by-default means genuinely risky actions pause for a human. The **Risk Tolerance** setting (Low default / Medium) and earned auto-approval tune that so routine, reversible work stays quiet — but the hard floors never yield. That friction is the point on a machine with access to your life.
- **Starfish is younger.** OpenClaw has a huge head start in raw integrations and community. Starfish's bet is that governance, not integration count, is what decides whether people can *trust* an agent with real authority.
- **Chat/messaging parity is on the roadmap.** OpenClaw's messaging-app UX is a real strength; Starfish leads with a desktop approval cockpit today, with a chat surface and connectors planned.

## Who should pick which

- **Pick OpenClaw** if you want maximum integrations today on a machine where a mistake or a bad skill is cheap, and you'll own the risk yourself.
- **Pick Starfish** if the agent will touch anything you can't afford to lose — real files, credentials, money, customers — and you want proof, not hope, that it stayed in bounds.

*Sources: OpenClaw overview/adoption ([Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)); security incidents ([cyberdesserts](https://blog.cyberdesserts.com/openclaw-malicious-skills-security/), [Stormshield](https://www.stormshield.com/news/openclaw-claude-risks-and-retrospectives/)). Starfish controls: `GOVERNANCE.md`, `docs/RISK_MODEL_*`, `docs/planning/…THREAT MODEL…`.*
