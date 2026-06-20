# Project Starfish

> **A governance-first, deny-by-default overlay for AI agent & skill builds.**
> Everyone ships skills. Nobody ships governance. **Starfish is the governance.**

`project-starfish` is the `starfish` CLI: drop it onto any Claude / AI agent or skill build and it
brings that build under governance — every capability passes a single decision point that defaults to
**deny**, and skills are guests inside governance rather than the other way around.

Self-contained, single-file bundle. No runtime dependencies. Local-only. MIT.

🌐 [projectstarfish.ca](https://projectstarfish.ca) · 📦 [GitHub](https://github.com/Azerax/Starfish)

---

## Install

```bash
# from npm
npm install -g project-starfish
# …or run without installing
npx project-starfish govern ./my-skill-pack

# from GitHub (same CLI, built on install)
npm install -g github:Azerax/Starfish
```

Requires Node.js >= 18.

## Use

```bash
starfish govern <pack-dir> [--apply] [--approve id1,id2]
```

`starfish govern` inventories a build, **vets every capability** (static review + provenance +
prompt-injection screen -> a risk tier), and installs the gate:

- **Low risk** -> auto-registered.
- **Medium and up** -> quarantined, pending your explicit `--approve`.
- **Prompt-injection** (a skill telling the model to ignore its instructions) -> rejected outright.

Quarantined capabilities cannot run until you approve them. Nothing executes ungoverned.

## Why

LLM agents are powerful and easy to extend with "skills," but skills run with real authority — files,
shell, network, money. Most ecosystems bolt safety on afterward. Starfish inverts that: **governance
loads first and is not optional.**

What it brings under one governed decision point:

- **Deny by default** — no capability acts without authorization.
- **Vetting is the only door** — provenance, license, static signals, and a prompt-injection screen.
- **Per-skill confinement** — each skill runs in its own workspace; other skills, the governance dir,
  and the audit log are invisible to it.
- **Integrity, verified** — per-file SHA-256 manifests; tamper -> auto-quarantine.
- **Evidence-based** — an agent's claims ("tests pass," "I ran X") are checked against the recorded
  deeds; unbacked claims are blocked.
- **Recoverable by design** — deletes are impact-assessed and soft (no system files, no skills, no
  folders); secrets (`.env` / credentials) are gatekept and never silently exfiltrated.
- **Tamper-evident audit** — a hash-chained, append-only log; optional external anchoring.
- **Model-agnostic** — Anthropic, OpenAI, Gemini, a local model, or a router; governance is the same
  constant whichever model runs the work.

## What this package is

This is the **governance CLI / overlay**. The desktop app (GCS Starfish — a bridge UI that visualizes
the governance model) is distributed separately. See the [repo](https://github.com/Azerax/Starfish)
for the full monorepo, the constitution (`GOVERNANCE.md`), and the threat model.

## License

MIT.
