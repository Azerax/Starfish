# Adversarial hardening + evidence program

> **Opened 2026-07-20.** Goal: every public claim Starfish makes is backed by a captured, reproducible
> artifact — and every control that can be broken has been attacked deliberately before someone else
> does it. Governed by `GOVERNANCE.md` §3 Principle 6: *no unbacked word*, applied to ourselves.
>
> Companion registers: [`EVIDENCE_BACKLOG.md`](EVIDENCE_BACKLOG.md) (claims awaiting proof) ·
> [`HARDENING_BACKLOG.md`](HARDENING_BACKLOG.md) (known-weak controls) ·
> [`AUDIT_QUESTIONNAIRE.md`](AUDIT_QUESTIONNAIRE.md) (the audit instrument).

---

## 0. The reframe: prove the surface, don't count attacks

The instinct is "find 1000 exploits." The honest reading of where we actually stand says otherwise:

| | Today |
|---|---|
| Attacks **documented** across all threat docs | ~150+ |
| Attacks **executed as tests** | substantial but uncounted — 602 tests, adversarial share unknown |
| Attacks with **captured, human-viewable evidence** | ≈ 0 |
| Controls known to lean on roadmap/docs/UX rather than code | 6 (H1–H6), already named |

Attack #151 through #1000 has low marginal value against *executing and capturing* what we already
know. **Quantity without a taxonomy produces duplicates and false confidence** — 1000 findings that
are really 60 findings restated is worse than 60, because it hides the shape of the surface.

So the target is **coverage of the attack surface**, and a count that falls out of it honestly. If ten
surfaces genuinely yield a hundred distinct attacks each, we will have a thousand and they will mean
something. If they yield sixty, we report sixty.

**Two traps this plan is built to avoid:**

1. **The simon-os failure mode.** A correctly-sequenced 13-work-package plan that stalled at 12% because
   a late phase depended on data an early phase could never produce. Every phase here must ship value
   standalone and must not be gated on a phase that cannot complete.
2. **Fix-then-capture.** If hardening and evidence are separate phases, evidence rots in the gap between
   them. Evidence is captured **in the same loop as the fix**, per attack, or it is not captured.

---

## Phase 0 — Harvest what is already proven  *(~1 day, free, do this first)*

We may already be able to back most of what we want to say. Nobody has checked.

**Work:** walk all 98 test files. For each test, record the claim it backs, the threat id it maps to,
and whether it is adversarial (plants a real hostile artifact) or a unit assertion. Produce a
**claims-to-evidence matrix**.

**Why first:** it is free, it is fast, and it sizes the real gap. It very likely shows that a large
share of the public claims are *already backed* and simply never surfaced. Nothing else should start
until we know what we have.

**Exit:** a matrix of `claim → test → threat id → adversarial?` and a list of claims with no backing test.

---

## Phase 1 — One attack register  *(~1–2 days)*

Attacks currently live in six documents with overlapping numbering schemes (`A#`, `T-`, `H`, `T1–T20`,
`P`/`M` persona ids, questionnaire `A1–J2`). No one can answer "how many distinct attacks do we know
about" without reading all six.

**Work:** dedupe into one register keyed by **surface**, each row carrying: id, surface, description,
current mitigation, **enforced-in-code vs leaning-on-roadmap/docs/UX**, test status, evidence status.

**Exit:** a single register; every existing threat doc points at it rather than restating it. The
"leaning" column is the honest hardening queue, and H1–H6 should reappear as its top rows — if they
don't, the register is wrong.

---

## Phase 2 — Systematic discovery, by surface  *(the "ballistic" phase)*

Adversarial sweep, one surface at a time, red-team framing: *assume the control fails, find how.*
Ten surfaces, because ten is what the architecture actually has:

| # | Surface | Sample attack classes |
|---|---|---|
| S1 | **The enforcement seam** | hook bypass, `--dangerously-skip-permissions`, permission-mode defaults, subagent inheritance, MCP permission-tool spoofing, seam removal via settings edit |
| S2 | **Boundary / path** | `../` traversal, absolute paths, symlink components, UNC + device paths, case-fold, unicode normalization, long-path, TOCTOU between check and open |
| S3 | **Command / exec composition** | the T-05 class generalized: git hooks, npm lifecycle scripts, `.gitconfig` aliases, env-var injection (`GIT_*`, `NODE_OPTIONS`, `LD_PRELOAD`), shell metacharacter smuggling, argument injection |
| S4 | **Egress / exfiltration** | DNS + redirect chains, numeric-IP encodings (C6), cloud metadata endpoints, `.internal` suffixes, MCP tools as an egress path, exfil via error messages and filenames |
| S5 | **Memory** | the 20 in `MEMORY_WIKI_THREATS.md`, executed rather than described |
| S6 | **Supply chain / intake** | unsigned updates, skill tampering post-vetting, MCP server substitution, dependency confusion, publisher-key handling |
| S7 | **The second privileged path (desktop / IPC)** | unauthenticated IPC channels, renderer→main privilege escalation, XSS→IPC, preload surface |
| S8 | **Audit integrity** | truncation, torn tail, rotation-segment gaps, replay, chain forgery, redaction bypass, audit-write failure handling |
| S9 | **The embed / sidecar path** | advisory-vs-enforcing (proven — see `examples/zero-change-demo`), token handling, multi-root isolation, wire-schema abuse |
| S10 | **Self-integrity + safe mode** | manifest tamper, rollback, safe-mode as a DoS, state-file deletion vs corruption |

**Method per surface:** independent adversarial passes with fresh framing, deduped against the Phase-1
register, then each candidate **verified by execution** — a finding is not a finding until an attack
script demonstrates it or a test refutes it. Findings that survive get a row and a fix.

**Cost warning:** this is the expensive phase — heavy parallel agent work and real machine load. It
should run on the new hardware, not alongside Outlook and a second Claude session. Budget it per
surface and stop when a surface goes two passes without a novel finding, rather than chasing a number.

**Exit per surface:** attacks enumerated, executed, classified `refuted` / `contained` / **`open`**.

---

## Phase 3 — Fix, without crippling

**"Without crippling Starfish" needs a mechanism, not an intention.** Hardening pressure always
trends toward more prompts, more denials, more friction — that is how a governance product becomes
unusable while every individual change looks justified.

**The golden-path gate.** Before any Phase-3 change lands, define and freeze a usability baseline:

1. The zero-change demo completes (all three skills, expected outcomes).
2. A governed Claude Code session completes an ordinary dev task end to end.
3. The Calm Home flow: type a brief → artifact produced.
4. **Ask-rate ceiling** — an ordinary session stays under N operator prompts. (The simon-os plan set
   `< 5 asks/day`; we should set ours from measurement, not guess.)

Every hardening change must keep all four green. A fix that raises ask-rate past the ceiling is not
shipped, it is redesigned. This is the only thing standing between "hardened" and "unusable."

**Prioritisation:** `open` findings on surfaces where the mitigation currently *leans* (the Phase-1
column) come first. H1 (OS isolation) will dominate several surfaces and is explicitly post-1.0 — do
not let it block the rest; record what it would close and move on.

---

## Phase 4 — Evidence capture, automated

**Hand-captured screenshots rot at the next release.** A folder of 1000 stale PNGs is worse than none,
because it looks like proof. So evidence is **generated by the suite**, not by a person.

**Three evidence tiers:**

| Tier | For | Artifact |
|---|---|---|
| **Transcript** | any control | the attack script, its output, the refusal, exit codes |
| **Chain** | anything audited | `audit.jsonl` excerpt with `seq` numbers + a passing `verify()` |
| **Screenshot** | anything an operator *sees* | automated capture of the app: approval cards, refusals, the Calm Home, safe-mode |

Screenshots are the tier that needs new machinery: drive the Electron app programmatically, capture at
fixed viewports, write to a versioned evidence directory. Everything else falls out of tests that
already run — they simply need to *emit* rather than assert silently.

**Output:** a regenerated evidence set, versioned with the release, where each artifact is addressable
and linked from the claim it backs.

**The gate that makes it stick:** a CI check that fails the build when a public document makes a
capability claim with no linked evidence artifact — `claims.ts` pointed at our own docs. Without it,
this program is a one-time cleanup and the drift restarts the next day.

---

## Sequencing

```
Phase 0 (harvest)  ──►  Phase 1 (register)  ──►  Phase 2 (discovery, per surface)
                                                        │
                                    ┌───────────────────┴──────────────────┐
                                    ▼                                       ▼
                        Phase 3 (fix + golden-path gate)  ◄──►  Phase 4 (capture)
                                    └───────────────────┬──────────────────┘
                                                        ▼
                                          CI evidence gate (permanent)
```

Phases 3 and 4 run **together, per finding** — fix and capture in the same loop, never as separate
campaigns.

**Do Phase 0 before committing to the rest.** It is one day, it costs nothing, and it is the only
honest way to size this. If it shows most claims are already backed, this is a capture exercise. If it
shows they are not, it is a hardening program. We do not yet know which, and deciding before we know
is how 13-work-package plans stall at work package three.

---

## Standing rules

- A finding is not a finding until executed. Analysis proposes; execution decides.
- Fix and evidence ship together, or neither ships.
- No hardening change lands that breaks the golden path.
- No public claim without a linked artifact.
- Report the count we actually find. If it is 60, it is 60.
