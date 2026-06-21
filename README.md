# Project Starfish

> **A Governance-First, Deny-by-Default AI Ecosystem.**
> Everyone ships skills. Nobody ships governance. **Starfish is the governance.**

[![npm](https://img.shields.io/npm/v/project-starfish.svg)](https://www.npmjs.com/package/project-starfish)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Project Starfish is two things built from one trusted core:

1. **A portable governance overlay** — drop it onto *any* existing Claude / AI agent or skill build and
   it brings that build under governance: every tool call, agent action, and capability passes a single
   decision point that defaults to **deny**.
2. **GCS Starfish** — a governed desktop app (Electron + React) that *visualizes* the model: a
   bridge / mission-control UI where you see and approve what your agents are doing.

It's an original, clean-room project. (Conceptually inspired by the open-source `munder-difflin`
project, MIT — no upstream code or assets are used; see `NOTICE`.)

> ⚠️ **Status: research preview / active build.** The governance core is implemented and heavily
> tested (**274 conformance/determinism tests green**); the desktop UI is being built on top of it.
> 🌐 [projectstarfish.ca](https://projectstarfish.ca)

---

## Install

The `starfish` CLI installs from **npm** or **GitHub** as one self-contained bundle (no runtime deps):

```bash
# npm
npm install -g project-starfish        # or: npx project-starfish govern <pack-dir>

# GitHub
npm install -g github:Azerax/Starfish  # builds the bundle on install

# from a clone (contributors)
git clone https://github.com/Azerax/Starfish.git && cd Starfish && npm install
```

Then:

```bash
starfish govern ./my-skill-pack [--apply] [--approve id1,id2]
```

`starfish govern` inventories a build, **vets every capability** (static review + provenance +
prompt-injection screen → a risk tier) and installs the gate: **low** auto-registers; **medium+** is
quarantined pending your `--approve`; **prompt-injection** is rejected outright. Requires Node ≥ 18.
See [`INSTALL.md`](INSTALL.md).

## Why

LLM agents are powerful and easy to extend with "skills," but skills run with real authority — files,
shell, network, money. Most ecosystems bolt safety on afterward. Starfish inverts that: **governance
loads first and is not optional**, and capabilities are guests inside it, not the other way around.

## Constitutional principles

The supreme source of truth is [`GOVERNANCE.md`](GOVERNANCE.md):

- **Governance precedes execution** — no action without authorization. Default: **DENY**.
- **All work is a task** — nothing runs outside the governed task lifecycle. *No task, no tool.*
- **Auditability** — every meaningful action is recorded to a hash-chained, append-only log.
- **Bounded autonomy** — agents may automate work; they may never expand their own authority.
- **Human authority** — a human is the final approver. **Proposer ≠ approver.**
- **Evidence-based ("no unbacked word")** — an agent's claims ("tests pass," "I ran X") are checked
  against the recorded deeds; unbacked or contradicted claims are blocked.
- **Fail-closed** — missing or corrupt governance halts startup; nothing runs ungoverned.

## Security & integrity model

- **Vetting is the only door** — provenance, license, static signals (network / code-exec /
  obfuscation / fs-write / credential), and a prompt-injection screen → a risk tier. **Low** auto-
  registers; **medium+** is quarantined pending consent.
- **Prompt-injection = highest tier → hard reject** — overrides even a trusted publisher.
- **Publisher signing (Ed25519)** — a skill signed over its manifest hash by a pinned key is
  cryptographically trusted.
- **Per-skill confinement** — each skill gets a unique workspace (`source` read-only, `workspace`
  read/write); other skills, the governance dir, and the audit log are invisible to it. No symlinks.
- **Integrity, triple-checked** — per-file SHA-256 manifests; verify-before-invoke + before/during/
  after hashing; drift → auto-quarantine.
- **Governed deletion** — every delete is impact-assessed and **soft** (recoverable). Hard rules:
  **no system files, no skills, no folders.** A dedicated **Custodian** does safe file-level cleanup.
- **Secret-scoped (`.env`/credentials)** — reading is deny-by-default; **Toby is the gatekeeper** for
  add/modify/remove; content is screened for poisoning; secret values never egress.
- **External sources (MCP / network / websites)** — deny-by-default until an agent verifies safety or
  the operator overrides; admitted sources are **tainted** (content injection-screened before re-entry;
  tainted data can't egress to a foreign destination). Signed blocklist = remote kill.
- **Model-agnostic** — Anthropic, OpenAI, Gemini, a local model, or a router; governance is the same
  constant whichever model runs the work. API keys live in the OS keychain, never in code or `.env`.
- **Operator-signed self-integrity** — the system verifies *itself* the way it verifies skills; tamper
  → safe mode. Optional external **anchoring** of the audit root (for institutions / auditors).

Full adversarial analysis: [`docs/SKILL_ISOLATION_THREATS.md`](docs/SKILL_ISOLATION_THREATS.md).
Design plans: `docs/SLASH_COMMAND_GOVERNANCE.md`, `docs/EXTERNAL_SOURCE_GOVERNANCE.md`.

## Architecture — layered "rings"

A package may import only strictly **lower** layers (CI-enforced). Governance imports nothing from
transports or the app.

| Package | Ring | Role |
|---|---|---|
| `@starfish/governance-core` | 1 (TCB) | PDP choke point, boundary engine, hash-chained audit, registries, risk/policy, task lifecycle, Token Governor, vetting, runtime monitor, model router / dispatch / runner, agent loop, evidence gate, deletion + secrets + external-source gates, self-integrity, anchoring. No UI. |
| `@starfish/governance-hooks` | 2 | PreToolUse/Stop hook shim + a local PDP daemon — the live enforcement seam. |
| `@starfish/governance-overlay` | 2 | `starfish govern <pack>` — inventory → vet → consent → install. |
| `@starfish/desktop` | 3 | GCS Starfish: the governed Electron host + React UI. |
| `project-starfish` (`packages/cli`) | — | the published, self-contained `starfish` CLI bundle. |

The **crew** (IP-safe *Fleet* theme): an orchestrator, a planner, **Oh Brian** (intake & vetting — the
only door), **Constable Gooey** (read-only runtime monitor), a memory/planner, and the **Quartermaster**
(Custodian — safe cleanup). Internal ids are stable; the theme is a swappable skin.

## Develop

```bash
npm install
npm run ci    # typecheck + tests + conformance + determinism + dep-direction lint + IP scan + SBOM/licence
```

Self-governed gates: a **dependency-direction lint** (ring layering holds), an **IP-denylist scan** over
shippable source, and an **SBOM + license check**.

## Repository layout

```
packages/
  governance-core/      ring 1 — the trusted core (+ conformance/determinism tests)
  governance-hooks/     ring 2 — hook shim + PDP daemon
  governance-overlay/   ring 2 — `starfish govern`; default-skills catalog + vetting records
  desktop/              ring 3 — governed host (src/) + Electron+React app (app/)
  cli/                  the published `project-starfish` CLI bundle
docs/                   GOVERNANCE-adjacent docs, threat model, design plans, UI mockups
site/                   projectstarfish.ca landing page
scripts/                CI gates + the CLI bundler
GOVERNANCE.md           constitutional source of truth
```

## License & attribution

Apache-2.0 (see `LICENSE`) — free for personal **and** commercial use. The Project Starfish name/logo are trademarks (see `TRADEMARK.md`); enterprise/compliance/cloud modules are offered separately (see `COMMERCIAL.md`). The document-creation skills referenced from the default catalog are
source-available (not OSS) — confirm their terms before redistribution. See `NOTICE` for attribution.
All Project Starfish art is original (see `docs/ART_PROVENANCE_LEDGER.md`).

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Latest: **v0.10.0** — govern Claude Code (deny-by-default overlay).
