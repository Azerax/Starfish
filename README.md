# Project Starfish

> **A Governance-First, Deny-by-Default AI Ecosystem.**
> Everyone ships skills. Nobody ships governance. **Starfish is the governance.**

Project Starfish is two things built from one trusted core:

1. **A portable governance overlay** — drop it onto *any* existing Claude / agent skills build and it brings that build under governance: every tool call, agent action, and capability passes a single decision point that defaults to **deny**.
2. **GCS Starfish** — a governed desktop app (Electron + React) that *visualizes* the governance model: a bridge/mission-control UI where you can see and approve what your agents are doing.

It is an original, clean-room project. (Conceptually inspired by the open-source `munder-difflin` project, MIT — no upstream code or assets are used. See `NOTICE`.)

> ⚠️ **Status: research preview / active build.** The governance core is implemented and heavily tested (143 conformance/determinism tests green); the desktop UI is being built on top of it.

---

## Why

LLM agents are getting powerful and easy to extend with "skills," but skills run with real authority — files, shell, network, money. Most ecosystems bolt safety on as an afterthought. Starfish inverts that: **governance loads first and is not optional**, and capabilities are guests inside it, not the other way around.

## Philosophy

The constitutional principles (see `GOVERNANCE.md`, the supreme source of truth):

- **Governance precedes execution.** No action occurs without authorization. Default decision: **DENY**.
- **All work is a task.** Nothing executes outside the governed task lifecycle. *No task, no tool.*
- **Auditability.** Every meaningful action is recorded to a hash-chained, append-only log. No silent execution.
- **Bounded autonomy.** Agents may automate work; they may never expand their own authority.
- **Deterministic operation.** Same inputs + policy ⇒ same decision.
- **Human authority.** A human is the final approver. **Proposer ≠ approver** — agents can never self-authorize.
- **Fail-closed.** Missing or corrupt governance halts startup; nothing runs ungoverned.

## Architecture — layered "rings"

A package may import only strictly **lower** layers (CI-enforced). Governance imports nothing from transports or the app.

| Package | Ring | Role |
|---|---|---|
| `@starfish/governance-core` | 1 (TCB) | The trusted core: **PDP** choke point, boundary engine, hash-chained audit, registries, risk/policy engines, task lifecycle, Token Governor, governed memory, capability vetting, runtime monitor, planner. No UI, no app imports. |
| `@starfish/governance-hooks` | 2 | PreToolUse/Stop hook shim + a local **PDP daemon** — the live enforcement seam between agents and the core. |
| `@starfish/governance-overlay` | 2 | The product: `starfish govern <pack>` — inventory → vet → consent → install. |
| `@starfish/desktop` | 3 | GCS Starfish: the governed Electron host + React UI (Bridge, onboarding, themes). |

The **crew** (agents), shown in the IP-safe *Fleet* theme: an orchestrator, a planner, **Toby** (capability intake & vetting — the only door into the registry), **Hank** (read-only runtime security monitor), and a memory/knowledge agent. Internal ids stay stable; the theme is just a swappable skin.

## Security & integrity model

Skills are **not trusted by default**. Every capability enters the registry only through Toby's vetting:

- **Vetting (the only door):** deterministic static review (network / code-exec / obfuscation / fs-write / credential signals) + provenance + license → a risk tier and disposition. **Low** auto-registers; **Medium+** is quarantined pending the operator's explicit **consent**.
- **Prompt-injection = highest tier → hard reject.** Any skill containing instructions to ignore/override prior or system instructions is assigned the top `injection` tier and **rejected outright** — it can never be registered or approved, and this **overrides trusted-publisher** status.
- **Publisher signing (Ed25519).** A skill signed over its manifest hash by a **pinned publisher key** is cryptographically trusted — stronger than a self-asserted provenance string.
- **Integrity, triple-checked.** Per-file SHA-256 manifest captured at vet time; **verify-before-invoke** plus a before/during/after hash check around execution. Any drift → auto-quarantine + Critical audit. (SHA-256, not MD5.)
- **Per-skill confinement.** Each skill gets a **unique workspace** (`source` read-only, `workspace` read/write); other skills, the governance dir, audit, and state are **invisible**. Enforced on every call by the boundary engine.
- **No symlinks, anywhere.** Skill trees containing symlinks are rejected; the boundary engine rejects symlink traversal at runtime.
- **Identity binding.** `agentId` and `capabilityId` are bound at the connection handshake, never trusted from the payload (blocks impersonation / confused-deputy).
- **Governed listing.** Even `dir`/`ls` goes through the PDP and is audited; Hank flags listing-probing/enumeration.
- **Tamper-evident audit.** Append-only + hash-chained; a watcher that reports "all clear" while real events exist trips its own Critical alarm.

Full adversarial analysis: [`docs/SKILL_ISOLATION_THREATS.md`](docs/SKILL_ISOLATION_THREATS.md). Governance vetting record: [`packages/governance-overlay/defaults/VETTING.md`](packages/governance-overlay/defaults/VETTING.md).

## Default skills

A starter catalog ([`packages/governance-overlay/defaults/default-skills.json`](packages/governance-overlay/defaults/default-skills.json)) sourced from [`anthropics/skills`](https://github.com/anthropics/skills) — document skills (docx/pdf/pptx/xlsx), example skills, and the Claude API reference. They are candidates only: each is vetted through the same governed door before it can run.

## The desktop app (GCS Starfish)

Electron + React (`packages/desktop/app`). A flashy governed-boot **splash**, a first-run **onboarding wizard** (operator identity → theme → governed intake/consent), and the **Bridge** (Mission Control): live crew status, the PDP decision feed, Token Governor budgets, and Hank's monitor — themeable at runtime (Fleet + a neutral Ops theme; users can add their own). UI design references live in [`docs/ui-mockups/`](docs/ui-mockups/).

```bash
cd packages/desktop/app
npm install
npm run init:gov     # seed a minimal governance config (one-time)
npm run dev          # Electron: splash → onboarding → Bridge
npm run dev:web      # browser-only UI preview (mock bridge), no Electron
```

## Develop

```bash
npm install
npm run ci    # typecheck + tests + conformance + determinism + dependency-direction lint + IP scan + SBOM/licence check
```

The repo is governed by its own gates: a **dependency-direction lint** (the ring layering holds), an **IP-denylist scan** over shippable source, and an **SBOM + license check**.

## Repository layout

```
packages/
  governance-core/      ring 1 — the trusted core (+ conformance/determinism tests)
  governance-hooks/     ring 2 — hook shim + PDP daemon
  governance-overlay/   ring 2 — `starfish govern`; default-skills catalog + vetting records
  desktop/              ring 3 — governed host (src/) + Electron+React app (app/)
docs/                   GOVERNANCE-adjacent docs, threat model, UI mockups
scripts/                CI gates (dep-direction lint, IP scan, SBOM)
GOVERNANCE.md           constitutional source of truth
```

## License & attribution

MIT (see `LICENSE`). The document-creation skills referenced from the default catalog are source-available (not OSS) — confirm their terms before redistribution. See `NOTICE` for full attribution. All Project Starfish art is original (see `docs/ART_PROVENANCE_LEDGER.md`).
