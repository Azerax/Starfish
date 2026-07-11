# Starfish vs Hermes

> **TL;DR:** Hermes (Nous Research) made a brilliant bet — an agent that *learns from your workflows and writes its own skills*, self-hosted and model-agnostic. That self-improvement is powerful and, ungoverned, it's also the scariest property an agent can have. Starfish's answer: keep the capability, but make **every self-authored skill and every learned behavior earn trust before it can act.**

## Credit where it's due

Hermes is the fastest-growing self-hosted agent of 2026 (135k+ GitHub stars in under three months, the most-used agent by daily tokens) precisely because it solved something most frameworks ignore: **memory and compounding capability.** It treats every task as a chance to learn something reusable, and it generates skill files from your actual workflows. That's a genuine advance. Starfish isn't arguing against self-improvement — it's arguing that self-improvement without governance is an agent quietly expanding its own authority, which is the exact thing governance exists to bound.

## What they share (the capability bar)

| Capability | Hermes | Starfish |
|---|---|---|
| Self-hosted, model-agnostic | ✅ | ✅ |
| Persistent memory / compounding capability | ✅ | ✅ (governed memory: evidence → approved knowledge) |
| Executes code, searches web, manages files | ✅ | ✅ (each gated + audited) |
| Many messaging platforms | ✅ (20+) | ▲ desktop cockpit today; connectors on the roadmap |
| **Writes its own skills from your workflows** | ✅ (`~/.hermes/skills/`) | ✅ **but through the Arena** — a self-authored skill is untrusted until it proves itself |

## Where they differ: who gets to trust a new skill

Hermes's headline feature — the agent writing and then running its own automation — is, in governance terms, **an agent minting new capability for itself.** Starfish keeps the feature and changes who's in charge of trusting it:

- **Self-authored skills are untrusted by default.** In Starfish, a newly generated skill is a *candidate*, not a live capability. It goes through **the Arena** (a no-OS proving ground): competence, non-deviation, injection-resistance, and canary/exfil trials, judged on recorded evidence — not the agent's own say-so — before it's signed and registered.
- **Bounded autonomy.** An agent may automate work; it may never expand its own authority. A learned behavior that drifts off its approved scope trips **non-deviation** enforcement and is stopped.
- **Provenance on everything remembered.** "Compounding capability" is only safe if you can see *why* the agent believes something. Starfish's memory is provenance-first: nothing is remembered because the model said so; recall reads only approved knowledge.
- **Earned auto-approval, revocable.** Trust is earned by a proven history of non-deviation and is revoked instantly on a single deviation — slow to earn, instant to lose.

## The risk Hermes's best feature creates

A self-improving agent that writes and runs its own skills is a supply chain of **one author who is also the executor** — no second set of eyes. That's the property behind the broader 2026 finding that a large share of agent-generated skills carry security flaws. Starfish's Arena + proposer≠approver is precisely a second set of (deterministic, evidence-based) eyes between "the agent wrote a skill" and "the skill can touch your system."

## Honest tradeoffs

- **Starfish adds a gate before a new skill goes live.** Hermes runs its self-authored skill immediately; Starfish makes it pass the Arena first. That's slower to first-use and deliberately so — time is not a factor when it comes to trust.
- **Hermes is ahead on reach and raw self-improvement velocity.** Starfish's bet is that *governed* compounding capability is the version enterprises and cautious individuals can actually adopt.
- **Messaging-platform breadth** is Hermes's strength today; Starfish leads with the approval cockpit and is adding connectors.

## Who should pick which

- **Pick Hermes** if you want maximum self-improvement velocity and you're comfortable being the sole reviewer of what your agent teaches itself.
- **Pick Starfish** if you love the idea of an agent that learns — but you want every new skill and learned behavior to *prove* it's safe, with an audit trail, before it can act.

*Sources: Hermes overview/adoption ([hermes-agent.org](https://hermes-agent.org/), [NxCode guide](https://www.nxcode.io/resources/news/hermes-agent-complete-guide-self-improving-ai)). Starfish controls: the Arena + non-deviation (`docs/planning/…Governed Execution — The Arena…`, `docs/planning/…Non-Deviation…`), `docs/starfish-scope-contract-impl` (shipped), `GOVERNANCE.md`.*
