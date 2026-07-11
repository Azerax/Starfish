# Starfish risk matrix — 50 categories

> **Date:** 2026-07-10 · **Status:** taxonomy for review. Feeds the Risk Tolerance setting (`RISK_TOLERANCE_PLAN.md`).
> Every governed action (tool call or task) is scored **1–10 on each applicable category** (1 = safest, 5 = moderate, 10 = maximal). Categories that don't apply default to **1**. The 50 category scores roll up into a single **0–100 composite**.

## How the 50 scores become one number

A naive average of 50 mostly-not-applicable rows would drown out the one dimension that matters, so the composite is **max-driven, not mean-driven**:

```
composite = min(100,  (highest category score × 10)  +  2 × (count of OTHER categories scoring ≥ 7, capped at +20))
```

- The **riskiest single dimension sets the floor** — one maxed category (e.g. "irreversible fund transfer") can never be diluted by 49 benign ones.
- **Stacking** multiple high-risk dimensions at once pushes the score higher (the accumulation bump).
- **Tier bands (decade-aligned):** 0–30 low · 31–50 medium · 51–70 high · 71–100 critical — with 10 finer **risk descriptors** below.
- **Risk Tolerance ceilings** (see the plan): Low auto-runs composite ≤ 30, Medium ≤ 70; **critical (71–100) always asks you**.

## Risk descriptors — the 0–100 scale in words

The composite carries a human-readable descriptor (shown in the UI and audit). Original to Starfish; the tier is the coarse rollup consumers read; floors + injection always override the band.

| Score | Descriptor | Tier | Meaning | Under Low | Under Medium |
|---|---|---|---|---|---|
| 0–10 | **Clear** | low | No meaningful access, impact, or exposure | auto | auto |
| 11–20 | **Contained** | low | Narrow capability, strong safeguards, trivial recovery | auto | auto |
| 21–30 | **Routine** | low | Small, self-recovering change within a known scope | auto | auto |
| 31–40 | **Noted** | medium | Real capability; proceeds but is logged and watched | ask | auto |
| 41–50 | **Weighty** | medium | Material risk; needs defined controls | ask | auto |
| 51–60 | **Heightened** | high | Significant access, scale, or business impact | ask | auto |
| 61–70 | **Gated** | high | Serious; key actions want a human before proceeding | ask | auto\* |
| 71–80 | **Acute** | critical | Major potential impact; strict limits and oversight | ask | ask |
| 81–90 | **Grave** | critical | Extreme exposure; potential for widespread harm | ask | ask |
| 91–100 | **Forbidden** | critical | Denied by default; runs only via explicit, supervised, exceptional authorization | deny/ask | deny/ask |

\* **Gated** auto-runs under Medium only if no category floor (and no irreversibility) is tripped; the floors still force a human. **Forbidden** is deny-by-default — even the operator takes an exceptional, supervised path, never a one-click auto-run. "Gated" and "Forbidden" carry *procedural* meaning (approval / prohibition), not just severity.

## Category floors (override the composite — a UI toggle can't lift these)

Independent of the composite, if any of these categories hits its red band it forces at least an **Ask**, and the constitutional hard-floor ones force a **Deny** regardless of Risk Tolerance: **#1 (system/shared storage), #11 (credentials/secrets), #8 (arbitrary execution), #12 (data exfiltration), #6 (irreversibility), #29 (self/governance tampering), #10 (loss of audit).** These are the matrix expression of Starfish's hard floors — the score can widen convenience, never open these doors. Prompt-injection (#33 at 10) is always a hard reject, off-scale.

Starfish also *pins some categories safe by design*: because auditing is mandatory and fail-closed, **#10 (Oversight)** is structurally near 1 for any governed action — a built-in advantage.

---

## The 50 categories

| # | Risk category | Risk 1 (low) | Risk 5 (moderate) | Risk 10 (maximal) |
|---|---|---|---|---|
| 1 | File and storage access | No access, or read-only to one approved file | Read/write within a restricted working folder | Modify, delete, encrypt, or overwrite across shared or system storage |
| 2 | Network and internet access | No network access | Limited to approved APIs or domains | Unrestricted internet, inbound connections, arbitrary endpoints |
| 3 | Data sensitivity | Public or synthetic data | Internal business info or limited personal data | Credentials, financial, health, regulated or highly confidential data |
| 4 | Scope and volume | One record, file, or account | Dozens–hundreds of items in a defined scope | Thousands of records or organization-wide data |
| 5 | Permissions and privilege | Guest, viewer, or sandbox | Standard authenticated user | Admin, root, production owner, billing/security admin, cross-tenant |
| 6 | Action reversibility | Preview only or fully reversible | Reversible with effort or from backups | Irreversible deletion, publication, fund transfer, or destructive change |
| 7 | External side effects | Internal analysis only, no external action | Creates drafts, tickets, or proposals | Sends messages, publishes, purchases, or changes production systems |
| 8 | Execution and code capability | Cannot execute code | Runs approved scripts in a sandbox | Arbitrary shell, code exec, installs, or infrastructure commands |
| 9 | Autonomy and decision authority | Every action human-approved | Rules-bound; approval for material actions | Chooses goals, tools, recipients, and timing without approval |
| 10 | Oversight, detection, auditability | Full logging, clear identity, real-time monitoring | Partial logs, periodic review | Little/no logging, shared identity, hidden actions, no audit trail |
| 11 | Credential and secret access | Touches no secrets | Uses a scoped, short-lived token | Reads, writes, or exports long-lived credentials or private keys |
| 12 | Data egress and exfiltration | No data leaves the boundary | Approved, minimized transfer to a known sink | Bulk export of sensitive data to arbitrary or foreign destinations |
| 13 | Data deletion and retention | No deletion; retention unchanged | Soft/recoverable removal of scoped items | Permanent purge or retention/legal-hold changes at scale |
| 14 | Data integrity and corruption | Read-only, no mutation | Bounded, validated edits | Silent, unvalidated modification of records or files |
| 15 | Privacy and personal data | No personal data involved | Minimal PII with a clear purpose | Profiling, tracking, or processing special-category personal data |
| 16 | Encryption and key management | No crypto operations | Uses managed keys via an approved API | Generates, rotates, exports, or deletes keys; changes crypto posture |
| 17 | Input trust and provenance | Trusted, first-party inputs only | Known third-party inputs, screened | Acts on untrusted files/sources (macros, links, unscreened content) |
| 18 | Intellectual property and licensing | Original or clearly licensed use | Internal use of third-party material | Redistributes, publishes, or relicenses others' IP |
| 19 | Software install and dependencies | Installs nothing | Adds a pinned, vetted dependency | Arbitrary package installs, unpinned or unverified supply chain |
| 20 | Configuration and settings changes | No config changes | Reversible app-level setting change | Alters security, network, or platform-wide configuration |
| 21 | Infrastructure and deployment | No infra interaction | Deploys to a dev/staging environment | Provisions, scales, or destroys production infrastructure |
| 22 | Database and schema operations | Read-only queries | Bounded row-level writes | Schema migrations, bulk updates, drops, or unindexed mass deletes |
| 23 | Access-control and sharing changes | No permission changes | Grants scoped access to one user | Alters ACLs, sharing, or roles broadly; makes resources public |
| 24 | Identity and authentication | No identity changes | Manages own session | Creates/alters accounts, resets MFA, changes auth providers |
| 25 | Third-party integration | No external services | Connects one approved, scoped service | Wires in arbitrary integrations or grants broad OAuth scopes |
| 26 | Production vs non-production target | Local or throwaway environment | Shared non-production (staging) | Live production systems or customer-facing services |
| 27 | Backup and continuity impact | No effect on backups/continuity | Touches non-critical, recoverable state | Disables backups, alters DR, or affects business continuity |
| 28 | Logging and telemetry integrity | Adds to logs normally | Reduces verbosity within policy | Disables, deletes, or forges logs/telemetry (anti-forensics) |
| 29 | Self-modification and governance | Cannot touch its own rules | Proposes a governed config change | Edits policies, the gate, audit, or its own permissions |
| 30 | Sub-agent spawning and delegation | No delegation | Spawns a scoped, supervised sub-task | Recursively spawns agents with inherited or broadened authority |
| 31 | Model and tool selection authority | Fixed model and tool set | Selects among approved models/tools | Freely chooses models, tools, or external providers |
| 32 | Scheduling and persistence | One-shot, no persistence | Scheduled task with review | Self-triggering, background, or persistent unsupervised operation |
| 33 | Prompt and instruction integrity | Instructions from trusted operator only | Mixed context, screened | Follows embedded/injected instructions from tainted content |
| 34 | Goal stability and non-deviation | Stays exactly on the approved scope | Minor in-scope reinterpretation | Redefines objectives or drifts off the approved mission |
| 35 | Privilege escalation over time | Authority fixed and bounded | Requests case-by-case elevation | Accrues or self-grants expanding authority across a session |
| 36 | Concurrency and fan-out | Single sequential action | A few parallel actions | Massive parallel fan-out across many targets at once |
| 37 | Rate and frequency | One action, rate-limited | Bounded batch within limits | High-frequency bursts that can overwhelm systems or quotas |
| 38 | Resource consumption and cost | Negligible, capped cost | Bounded spend within budget | Unbounded compute/token/API spend or cost amplification |
| 39 | Financial and payment authority | No financial capability | Reads financial data, no movement | Moves money, makes purchases, or changes billing |
| 40 | Communication and messaging reach | No outbound communication | Internal messages to a known team | Contacts customers/public or mass-messages external recipients |
| 41 | Content publication | Nothing published | Drafts held for review | Publishes public content, code, or releases irreversibly |
| 42 | Impersonation and social engineering | Acts only as itself, disclosed | Uses an approved service identity | Impersonates a person/brand or engineers others into actions |
| 43 | Physical and device control | No physical effect | Controls a low-stakes device with limits | Actuates robots, vehicles, locks, or safety-critical hardware |
| 44 | Human safety and wellbeing | No safety relevance | General non-critical guidance | Safety-critical advice or actions affecting health or physical harm |
| 45 | Legal and regulatory exposure | No regulated activity | Regulated data with controls | Actions risking GDPR/HIPAA/contract breach or unlawful conduct |
| 46 | Reputational and brand impact | Internal, no visibility | Limited-audience external artifact | Public statements or actions that can damage brand/reputation |
| 47 | Cross-tenant / multi-user blast radius | Affects only the operator | Affects a bounded team | Affects many tenants, users, or an entire organization |
| 48 | Downstream and dependency chain | No downstream systems | Affects one known dependent system | Cascades across many downstream or integrated systems |
| 49 | Time sensitivity and urgency | No time pressure | Soft deadline, room to review | Irreversible under urgency with no time to verify |
| 50 | Task ambiguity and clarity | Precise, fully specified task | Mostly clear with minor gaps | Vague or open-ended goal the agent must interpret broadly |

---

*Notes: categories overlap by design (defense in depth) — an action can trip several, which the accumulation bump rewards. The initial engine will score only a handful of these deterministically from real signals (path/tool/target/tier), defaulting the rest to 1; resolution is added as real, auditable signals are wired — granularity must be earned by evidence, never faked. Cross-ref: `packages/governance-core/src/risk.ts`, `pdp.ts` `combine()`, `RISK_TOLERANCE_PLAN.md`.*
