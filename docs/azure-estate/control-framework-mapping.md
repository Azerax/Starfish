# Estate Spec — Control Framework Mapping

**ISO/IEC 42001:2023 and NIST AI RMF 1.0 (NIST AI 100-1)**

Date: 2026-09-01 · Status: draft for internal review
Mapped against: `docs/azure-estate/spec/` (`estate.yaml`, `GOVERNANCE.md`, `estate.schema.json`) and `docs/azure-estate/tool-notes/` (`README.md`, `BLOCKERS.md`, `FIXTURES.md`)

> **Two headlines, both of which must travel with any use of this document.**
>
> 1. **Nothing is graded *fully covered* against either framework.** Four mechanisms are hard enforcement. The rest evidence, detect, or enforce process.
> 2. **No collector has ever run against a live Azure tenant** (`BLOCKERS.md` #1). Every drift-detection row below describes code that is unit-tested against handwritten fixtures encoding an assumption about what Azure returns. Until `FIXTURES.md` is executed, the detection half of this mapping is *designed and tested*, not *demonstrated*.

---

## 0. Provenance and method

### 0.1 What was read

| Source | Used for |
|---|---|
| `spec/estate.yaml` | The 8 baseline change gates and their **actual** resolutions; runtime gate config; audit, dataHandling and policy blocks |
| `spec/GOVERNANCE.md` | The 12 change-gate predicates; the least-privilege compilation table; the 8 narrative validation rules; the runtime-gate honesty statement |
| `spec/estate.schema.json`, `spec/workspaces/*.yaml` | Const-vs-enum decisions, workspace shape |
| `tool-notes/README.md` | Command surface; **12 validator rules, 15 drift rules**; collector inventory; design decisions |
| `tool-notes/BLOCKERS.md` | What is unproven and why — the single most important input to the grading |
| `tool-notes/FIXTURES.md` | The 17 drift findings by name, and the plan to validate them |
| `project-docs/09-preflight-and-signoff.md` | The knowledge-mapping sign-off gate (**proposed, not in baseline**) |
| `project-docs/11-commercial-model.md` | Buyer analysis only; no control claims drawn from it |

**The tool's source code is not in this repository** — `src/cli.ts`, `spec/validate.ts`, `rules.ts` and the four collectors are referenced by `tool-notes/README.md` but live elsewhere. Every row below is therefore graded against **documentation of the implementation**, not the implementation. Rule counts, rule content, and test coverage are as documented; none were read from source.

### 0.2 Corrections to earlier working numbers

An earlier draft of this mapping worked from a verbal brief. Three counts in it were wrong:

| Item | Earlier | Actual | Source |
|---|---|---|---|
| Change-gate predicates | 13 | **12** | `GOVERNANCE.md` §2 |
| Validator rules | 13 | **12** (R1–R12; R13 proposed, not accepted) | `tool-notes/README.md`; `11-commercial-model.md` §Open item |
| Drift rules | 17 | **15 rules**, exercised by **17 fixtures** (F1–F17) | `tool-notes/README.md`; `FIXTURES.md` |

`knowledge.pathChanged` appears as a predicate in the proposed sign-off gate (`09-preflight-and-signoff.md`) but is **not** in `GOVERNANCE.md`'s predicate list. Treated here as proposed.

### 0.3 Standard-text provenance

**ISO/IEC 42001:2023 — worked from secondary summaries, not the standard text.** ISO 42001 is paywalled and was not read directly. Every control ID and title was corroborated across two or more independent secondary sources. Annex A contains 38 controls across 9 objectives, A.2–A.10; A.1 is the annex's introductory clause, and each objective's `.1` slot is the objective statement, which is why every control starts at `.2`. Titles are ±1 word until checked against a licensed copy; identifiers are solid.

Two widely-circulated sources are materially wrong and were rejected: one inventing `A.3.4`, `A.6.2.9`, `A.9.5` and giving the real `A.10.3` ("Suppliers") a fabricated title; one presenting Annex A as A.1–A.11. **If a client's consultant cites A.9.5 "Human Oversight Aspects", no corroborated source contains it.**

⚠ **ISO 27001 / ISO 42001 ID collision.** Both standards have an A.8.2 and an A.8.5, and they are different controls. Every 27001 reference below is written `27001:A.x.x`; a bare `A.8.2` always means 42001.

| ID | ISO 42001:2023 | ISO 27001:2022 |
|---|---|---|
| A.8.2 | System documentation and information for users | Privileged access rights |
| A.8.5 | Information for interested parties | Secure authentication |

**NIST AI RMF 1.0 — read from the primary source.** All 72 subcategory IDs and statements from NIST AI 100-1 (Tables 1–4, pp. 21–34), cross-checked against the NIST AIRC Playbook JSON; 72/72 matched. Where Playbook wording differs (~20 of 72), the publication governs.

**Structural warning.** AI RMF subcategories are *outcomes*, not controls, and there is no NIST-defined pass criterion for any of them. A term-presence check across all 72 statements found that `access control`, `access`, `authorization`, `approval`, `audit`, `traceability`, `logging`, `versioning`, `provenance`, `drift` and `rollback` appear **nowhere** at subcategory level (`supply chain` appears only in the GOVERN 6 category title). The estate spec's two strongest capabilities — access-change gating and plan-hash-bound approval records — have no NIST subcategory written in their vocabulary. Every NIST row for those is reached by interpretation, and is labelled as ours rather than NIST's.

### 0.4 Classes and grades

| Class | Meaning |
|---|---|
| **ENFORCES** | Prevents the non-compliant state **via the governed path**. |
| **ENFORCES PROCESS** | Cannot prevent the outcome, but prevents it happening unreviewed. A human can approve a bad change; they cannot approve it silently. |
| **EVIDENCES** | Records or detects. The non-compliant state can still occur. |
| **DECLARES** | The spec states a requirement and fails the build if it is missing, but the enforcement itself happens outside the tool. Used for the runtime gate, and for nothing else. |

| Grade | Meaning | Count |
|---|---|---|
| **Fully covered** | No material element of the control left outside the tool. | **0** |
| **Partially covered** | Satisfies a nameable part; the unaddressed part is named in every row. | 20 ISO / 15 NIST |
| **Claimed only** | Arguable in a sales conversation; will not survive an assessor. Recorded as *rejected*. | 2 ISO / 6 NIST |

**⚠ The field-validation caveat, which applies to every EVIDENCES row derived from the collector.** `BLOCKERS.md` #1: *"the parsing half is tested (82 tests); the network half is assumption."* No collector has executed a single HTTP call against Azure. A wrong endpoint, api-version, pagination field or auth audience breaks the tool on first contact, and the risk is concentrated in the two data-plane collectors where documentation was thinnest. Two known false-negative paths are already documented: AI Search returns an empty index list when `authOptions` is keys-only (`BLOCKERS.md` #4), and `permissionFilter` is absent rather than null at the stable api-version, so a stable-version scan reports every shared index as dedicated (`tool-notes/README.md`). **Detection rows are therefore graded on design, and must not be presented to a client as demonstrated capability until `FIXTURES.md` step 9 passes.**

### 0.5 The predicate→resolution assignment (now known)

`estate.yaml` resolves the 8 baseline gates as follows. This was the largest unknown in the earlier draft and it is now settled:

| Gate | Predicate(s) | Resolution |
|---|---|---|
| `widen-access` | `access.groupWidened \|\| access.scopeWidened \|\| access.roleEscalated` | humanApproval |
| `new-write-tool` | `tools.added && tools.effectIncludes(write)` | humanApproval |
| `new-external-tool` | `tools.added && tools.effectIncludes(external)` | humanApproval |
| `knowledge-classification-raised` | `knowledge.sourceAdded \|\| knowledge.classificationRaised` | humanApproval |
| `limits-removed` | `model.limitsRemoved` | humanApproval |
| `preview-dependency` | `feature.usesPreview` | **acknowledgement** |
| `governance-weakened` | `governance.controlWeakened` | **block** |
| `local-keys-reenabled` | `resource.localKeysEnabled` | **block** |

Two predicates exist in `GOVERNANCE.md` but have **no baseline gate**: `tools.effectIncludes(read)` and `model.limitsRaised`. Available to a client-specific spec; unused in the shipped baseline.

---

## 1. Mapping — ISO/IEC 42001:2023 Annex A

### 1.1 Least privilege — the compiled controls

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| `localKeysDisabled: true` (const) → `disableLocalAuth` on every Foundry resource | *(no 42001 control)* | **ENFORCES** | — |
| `access.entraGroup`, one per workspace, no user lists | A.9.2 Processes for responsible use | ENFORCES PROCESS | Partially covered |
| `maxRoleScope: agent` → RBAC at `/…/agents/<a>` | A.9.4 Intended use of the AI system | ENFORCES PROCESS | Partially covered |
| `downstreamGrants: explicit` — every managed-identity role enumerated | A.4.5 System and computing resources | EVIDENCES | Partially covered |
| `separateProjectPerAccessPattern: true` (const) — validator fails divergent grants | A.9.4 | **ENFORCES** | Partially covered |

**Why two of these are genuine enforcement rather than policy.** Both rest on Azure facts, not preference: all unpublished agents in a Foundry project **share one managed identity**, so least privilege between two agents is only achievable by separate projects — the validator failing a workspace with divergent downstream grants is enforcing a platform constraint, not a house style. And key-based auth **bypasses RBAC entirely**, so one enabled key silently voids every grant above it. That is why `localKeysDisabled` is a const and `local-keys-reenabled` is a `block` gate.

**What is not covered.** A.9.2 expects documented processes for responsible *use* — user guidance, acceptable-use boundaries, escalation paths. The spec governs wiring, not use. A.9.4 expects intended use to be determined and documented; the spec declares the wiring that serves a purpose, never the purpose. A.4.5 records what scopes exist, not whether they are appropriately sized.

**Structural finding — ISO 42001 has no access-control Annex A control.** This is where 42001 draws its boundary, not a gap in the spec. The access work maps cleanly onto `27001:A.5.15` (Access control), `27001:A.5.16` (Identity management), `27001:A.5.18` (Access rights), `27001:A.8.2` (Privileged access rights), and `localKeysDisabled` onto `27001:A.5.17` / `27001:A.8.5`. For a combined 27001+42001 programme, lead this story in the 27001 half.

### 1.2 Change gate

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| `widen-access` (humanApproval) | A.9.2 · A.6.2.5 AI system deployment | ENFORCES PROCESS | Partially covered |
| `new-write-tool`, `new-external-tool` (humanApproval) | A.4.4 Tooling resources | ENFORCES PROCESS | Partially covered |
| `new-external-tool` | A.10.3 Suppliers | ENFORCES PROCESS | Partially covered |
| `knowledge-classification-raised` (humanApproval) | A.7.3 Acquisition of data | ENFORCES PROCESS | Partially covered |
| Declared knowledge sources and paths | A.7.5 Data provenance · A.4.3 Data resources | EVIDENCES | Partially covered |
| `limits-removed` (humanApproval) | A.4.5 | ENFORCES PROCESS | Partially covered |
| `preview-dependency` (**acknowledgement**) | A.6.2.2 AI system requirements and specification | **EVIDENCES** | Partially covered |
| `governance-weakened` → **block, no override** | A.2.4 Review of the AI policy | **ENFORCES** | Partially covered |
| `local-keys-reenabled` → **block, no override** | *(no 42001 control)* | **ENFORCES** | — |

**`preview-dependency` is EVIDENCES, not process enforcement, and the distinction matters.** `acknowledgement` means the operator confirms they read it and the confirmation is recorded. Nobody approves; nothing is refused. It raises visibility, not the bar. Do not describe the estate as having "twelve gates" without saying that one of the eight baseline gates only records.

**The two block gates are the strongest claim here**, and `GOVERNANCE.md` makes the argument well: *"A control you can waive under deadline pressure is not a control."* `governance-weakened` makes the implemented governance config non-weakenable **via the governed path** between reviews — which is the failure mode A.2.4's periodic review catches late. Partial because A.2.4 concerns the policy document and its review cadence, and nothing here causes a review to happen.

**Rejected: `preview-dependency` → A.6.2.4 (verification and validation).** Flagging a preview dependency is an admission that something is *unvalidated*. Calling that V&V inverts the control. See §1.5 for where A.6.2.4 is genuinely reachable.

**What is not covered.** A.4.4 expects rationale, provenance and assurance status of tooling; the spec declares existence and effect class. A.10.3 is substantially contractual due diligence. A.7.3 expects assessment of acquisition legality, licensing and consent — the gate reviews the *event* of acquisition, never its *legitimacy*. A.7.5 expects lineage through the data lifecycle; a declared source URI is a pointer, not a lineage record.

**⚠ A recursive-prefix hole the spec identifies in itself.** A container's folder path is a recursive prefix, so anything created underneath it after sign-off is indexed automatically with no gate firing (`09-preflight-and-signoff.md`). `knowledge.sourceAdded` fires on a *declared* source, not on new material appearing beneath one. **The approved mapping silently stops being true**, which the doc rightly notes is worse than never having signed one. This is a live gap in A.7.3 and A.7.5 coverage, not a theoretical one.

### 1.3 Runtime gate — declared, not enforced

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| Build fails when `effect: write\|external` has no matching gate | A.6.2.2 | **ENFORCES** | Partially covered |
| `runtimeGates.highStakes[]` → generated wrapper stub | A.9.4 | **DECLARES** | Partially covered |
| `onTimeout: deny` (default) | A.9.2 | **DECLARES** | Partially covered |

**This is the one control the spec cannot compile, and `GOVERNANCE.md` says so plainly:** *"Azure has no native per-action approval for agents… it declares the requirement and generates the wrapper stub, but the enforcement is yours."*

What is genuinely enforced is narrower and still valuable: **forgetting becomes impossible even though enforcing is manual.** A tool declaring `effect: write` or `effect: external` with no matching gate fails the build. That is a real, testable, deploy-blocking control — and it is a control over *the spec*, not over *the agent*.

`onTimeout: deny` is the right default and deserves its own line. An approval request that expires must fail closed; an agent proceeding because nobody answered in five minutes is worse than one with no gate, because the gate manufactures false confidence. But this is a value in a generated stub — **whether it is honoured depends on the customer's implementation**, which is why the class is DECLARES.

**The honest sentence for a client:** *the spec guarantees you cannot forget a high-stakes gate; it does not guarantee the gate stops anything.* Any pitch that blurs those two is the most consequential overclaim available in this product.

**`tools[].effect` is the field the whole model hangs on.** Understating it — calling a write tool `read` — silently skips both the change gate and the runtime gate. That is a single-field integrity dependency with no technical mitigation, only a review habit. Worth naming in any assessment conversation before an assessor finds it.

### 1.4 Audit

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| `audit.specChangeLog: git` — commit SHA + plan hash + gates fired + who cleared them | **A.6.2.8** AI system recording of event logs | EVIDENCES | Partially covered *(strongest ISO row)* |
| `audit.destination: logAnalytics`, `retentionDays: 365` → diagnostic settings on every Foundry resource, gateway, Search service | A.6.2.8 | EVIDENCES | Partially covered |
| `audit.recordGateDecisions: true` | A.6.2.8 | EVIDENCES | Partially covered |
| Versioned spec + decision history | A.6.2.3 Documentation of design and development · A.6.2.7 Technical documentation | EVIDENCES | Partially covered |
| `audit.includePromptContent: false`, forced at `confidential` and above | *(no 42001 control — `27001:A.8.10`/`A.8.11` territory)* | **ENFORCES** | — |

**The strongest artefact in the product is the plan-hash-bound approval record.** Most approval systems record *that* something was approved. `planHash` + `commit` + `countsAsOf` records *which state* was approved, so "was this specific configuration ever signed off" is answerable three years later from `git log` rather than reconstructed from ARM activity logs. `09-preflight-and-signoff.md` puts it best: *"An approval in an inbox is not evidence."*

**What is not covered — and it is the reason this is not graded fully covered.** A.6.2.8 in its primary reading concerns event logs of the **AI system in operation** — inference events, model input/output. This covers **orchestration-layer change events**. It records that an agent was permitted a tool; it does not record what the agent did with it. Runtime telemetry lands in the same Log Analytics store, but that is Azure's logging, configured by the spec, not produced by it. An assessor asking A.6.2.8 about model I/O logging gets a pointer to a diagnostic setting, not an artefact.

A.6.2.3 expects design rationale — why this architecture, what was rejected. The record captures what changed and who cleared it. A.6.2.7 expects capability and limitation documentation; the spec is a wiring diagram.

**`includePromptContent: false` deserves the enforcement class.** Forced at `confidential` and above, with the reasoning stated in `GOVERNANCE.md`: otherwise the audit log becomes a copy of everything users typed. That is a data-minimisation control that most audit implementations get wrong in the other direction, and 42001 has no control to receive it.

### 1.5 Data handling — data as information, not instructions

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| `forbidPrivilegeEscalationFromContent: true` (const) — deny-list assertion in the wrapper; **generated injection test suite, one case per tool** | **A.6.2.4** AI system verification and validation | ENFORCES PROCESS | Partially covered |
| `treatRetrievedContentAsUntrusted`, `treatToolOutputAsUntrusted`; `knowledge[].trust: untrusted` (const) | A.6.2.2 | ENFORCES PROCESS | Partially covered |
| `contentSafety: required` → `llm-content-safety` at the gateway, covering prompts, completions and MCP traffic | A.6.2.2 | ENFORCES PROCESS | Partially covered |
| Per-workspace index isolation; `store` as a const with one permitted value | A.7.2 Data for development and enhancement | **ENFORCES** | Partially covered |

**A.6.2.4 is reachable here and nowhere else in this document, and the scope limit is severe.** A generated per-tool prompt-injection test is a genuine verification artefact about system behaviour — it is a test, of the system, that can fail. That is more than any other mechanism in the spec produces. But A.6.2.4 covers verification and validation of the AI system's performance, robustness and safety in its operating conditions, and this tests **exactly one property: resistance to privilege escalation from retrieved content**. Nothing tests accuracy, reliability, or safety generally. Grade accordingly, and never let "we generate a test suite" stand in for V&V.

**Index isolation is structural rather than enforced at query time, and that is the strongest design decision in the spec.** Dropping cross-workspace knowledge removed the largest source of risk *cleanly* rather than by mitigation: no dependency on AI Search permission filters (preview for ~15 months, with fail-open/fail-closed behaviour on a missing token documented inconsistently by Microsoft), no on-behalf-of token plumbing, better retrieval relevance, and the whole path GA. The cost — duplicated storage where two workspaces need the same corpus — is correctly assessed: *"duplicating a corpus is cheaper than being wrong about who can read it."*

Recording `store` as a **const with one permitted value rather than an enum with one option** is a governance decision in itself: it puts the reasoning in the schema and forces any future attempt at sharing to be a deliberate schema change with an argument attached. That is the same discipline this mapping tries to apply, expressed in JSON Schema.

### 1.6 Azure Policy and tenant safety

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| `policy.allowedModelPublishers: [OpenAI, Microsoft]`, `onlyAllowDirectFromAzure: true` | **A.10.3** Suppliers | **ENFORCES** | Partially covered |
| `policy.denyPreviewModels: true` | A.6.2.2 | **ENFORCES** | Partially covered |
| Validator: `metadata.tenantId` ≠ signed-in tenant → **refuse to apply** | *(no 42001 control)* | **ENFORCES** | — |

**The model-publisher allowlist is the cleanest supply-chain control in the spec**, and it is enforced by Azure Policy rather than by the tool — which `estate.yaml` notes is *"GA, and strictly better than enforcing the same thing yourself."* Correct instinct: a control the platform enforces survives the tool being bypassed.

Partial against A.10.3 because supplier management is substantially contractual — due diligence, assurance evidence, contractual terms — and an allowlist of two publishers is the technical floor beneath that, not a substitute for it.

**The tenant guard is small and matters more than its size suggests.** The same spec shape ships to several clients; deploying one client's estate into another's tenant is the failure mode with the worst blast radius and no technical recovery. Refusing to apply on a tenant mismatch is the only guard against it. No framework control receives this.

### 1.7 Validator (12 rules) — and the discovery/diff distinction

| Mechanism | Control | Class | Grade |
|---|---|---|---|
| 12 structural rules; exit 1 on any error | A.6.2.2 | **ENFORCES PROCESS** | Partially covered |
| R5: any workspace `governance` value that widens an estate control → error (**tightening only, always**) | A.2.4 | **ENFORCES** | Partially covered |
| R7: `effect: write\|external` with no runtime gate → error | A.6.2.2 | **ENFORCES** | Partially covered |
| `estate preflight` — verifies every permission a scan needs before the engagement | A.6.2.5 AI system deployment | EVIDENCES | Partially covered |

**Rejected: the validator → A.6.2.4.** "Validator" and "verification and validation" share a word and nothing else. A.6.2.4 concerns validating that the *AI system* behaves as intended. Twelve structural rules over a YAML document validate a configuration. This would be the most likely overclaim in the document if §1.5 had not found a legitimate A.6.2.4 route; with §1.5 present, claiming it twice would be worse.

**The validator's real contribution is that several rules encode Azure facts that produce silent, hard-to-diagnose failures** — Agent Consumer not granting invoke on a published Agent Application (symptom: 403 for every user on a workspace that looks correct); the 32-deployment ceiling; the Search tier index ceiling; RBAC grants not transferring on publish. These are not schema checks; they are institutional knowledge made executable. That is worth more to a client than the framework row it maps to.

**What is not covered.** A.6.2.2 expects requirements traceable to intended purpose through to the built system. Twelve rules check internal consistency and platform limits.

**R13 — no guest or external principals in any `sg-ai-*` group backing a container — is proposed and not accepted** (`11-commercial-model.md`). It would be verifiable by the collector against a live tenant. Listed here as designed, not built.

### 1.8 Collector (15 drift rules, 17 fixtures) — designed, never run live

| Finding | Control | Class | Grade |
|---|---|---|---|
| `undeclared-workspace` (high) | A.4.2 Resource documentation | EVIDENCES | Partially covered ⚠ |
| `unowned-workspace` (medium) | A.3.2 AI roles and responsibilities · A.10.2 Allocating responsibilities | EVIDENCES | Partially covered ⚠ |
| `undeclared-index` (medium) | A.7.5 Data provenance | EVIDENCES | Partially covered ⚠ |
| `ungated-tools` (high) · `gate-unknown` (medium) · `mcp-unrestricted` (medium) | A.4.4 Tooling resources | EVIDENCES | Partially covered ⚠ |
| `local-keys-enabled` (high) | *(no 42001 control — `27001:A.5.17`)* | EVIDENCES | — ⚠ |
| `account-scope-grant` · `direct-user-grant` · `unresolved-principal` · `orphan-group` · `deprecated-role` | *(no 42001 control — `27001:A.5.15`/`A.5.16`/`A.5.18`)* | EVIDENCES | — ⚠ |
| `permission-filtered-index` (high) | A.7.2 | EVIDENCES | Partially covered ⚠ |
| `scan-incomplete` (high, sorts first) | A.6.2.6 AI system operation and monitoring | EVIDENCES | Partially covered ⚠ |
| All 15 rules collectively | A.6.2.6 | EVIDENCES | Partially covered ⚠ |

**⚠ on every row: no collector has executed one HTTP call against Azure.** See §0.4.

**Three design decisions in the collector are themselves governance-grade, and are worth more to an assessor than most of the rows above.**

*Gates are three-valued, not two.* MCP bindings record `require_approval`, so `ungated` there is a **fact from the tenant**. Every other tool type records nothing, so the answer is `undefined` — reported separately, one severity lower, phrased as a question to ask. `GOVERNANCE.md`'s reasoning: *"Accusing a tool that is gated in the calling app is how a report loses the room."* A tool that distinguishes *known-bad* from *unknown* is applying the same discipline as the fully-covered/partially-covered split in this document, and for the same reason.

*Effect is inferred pessimistically and always marked as inferred.* A tenant records what a tool *is*, never what it is *for*. Marking the inference is what stops a finding becoming an accusation.

*A partial scan says so, loudly.* Every collector degrades to a caveat rather than an empty list, and `scan-incomplete` always sorts first, with every count below labelled a floor. *"A scan that quietly returns less than it should looks exactly like a clean tenant."* This is the mechanism that makes A.6.2.6 defensible at all — monitoring that cannot report its own incompleteness is not monitoring.

**`unowned-workspace` → A.3.2 and A.10.2 is the most quietly valuable row in the document.** Both are organisational controls a tool ordinarily cannot touch. An unowned-workspace finding produces *technical proof that responsibility allocation has holes* — precisely the evidence an assessor wants and organisations almost never have. Partial in both cases: the tool detects an absent owner; it does not define the role model or assign anyone.

**What is not covered.** A.6.2.6 expects operational and performance monitoring of the AI system. This is **configuration** monitoring. Nothing observes model behaviour, quality, latency or cost in operation. And per `BLOCKERS.md` #4 and `tool-notes/README.md`, two documented false-negative paths already exist — a keys-only Search service returns an empty index list from a healthy service, and a stable-api-version scan reports every shared index as dedicated.

---

## 2. Mapping — NIST AI RMF 1.0

*§0.3 applies to every row: these are outcomes with no pass criterion, in a vocabulary that has no word for access, approval or logging.*

### 2.1 Strongest rows

| Mechanism | Subcategory | Class | Grade |
|---|---|---|---|
| Collector — intended-vs-actual estate scan | **GOVERN 1.6** inventory AI systems | EVIDENCES | Partially covered ⚠ |
| Change gate — humanApproval on the plan hash | **MANAGE 1.1** determination whether deployment should proceed | ENFORCES PROCESS | Partially covered |
| Declared spec as the control set; change gate keeps it declared | **MAP 4.2** internal risk controls for components identified and documented | ENFORCES PROCESS | Partially covered |
| 15 drift rules | **MEASURE 3.1** identify and track emergent risks | EVIDENCES | Partially covered ⚠ |
| Predicate→resolution table | **GOVERN 1.3** risk-management activity level by risk tolerance | ENFORCES PROCESS | Partially covered |
| `governance-weakened` → block | **GOVERN 1.4** process established through transparent policies and other controls | **ENFORCES** | Partially covered |
| Baseline gate config as a declared artefact | **MAP 1.5** risk tolerances determined and documented | EVIDENCES | Partially covered |

**GOVERN 1.6 is the cleanest match in the product** — a live scan diffed against a declared inventory is close to the mechanism GOVERN 1.6 names, and `undeclared` is, as `tool-notes/README.md` says, *"the only thing on the map that nobody can produce from documentation."* Not fully covered: the inventory is bounded to the declared Azure AI estate (shadow AI, SaaS AI features and embedded models are invisible), the second clause — *"resourced according to organizational risk priorities"* — is an organisational act, and the scan has never run.

**GOVERN 1.3 is the row most likely to be undersold.** Most organisations satisfy it with a prose paragraph about risk appetite. A predicate→resolution table with two non-waivable entries is that paragraph made executable and testable.

### 2.2 Human oversight

| Mechanism | Subcategory | Class | Grade |
|---|---|---|---|
| `humanApproval` with named approvers | **MAP 3.5** processes for human oversight defined, assessed, documented | ENFORCES PROCESS | Partially covered |
| Named approver per gate; client-side approver in the proposed sign-off gate | **GOVERN 3.2** roles for human-AI configurations and oversight | EVIDENCES | Partially covered |
| `runtimeGates.highStakes` + `onTimeout: deny` | **MANAGE 2.4** supersede / disengage / deactivate | **DECLARES** | Partially covered |

**MANAGE 2.4 is now a defensible partial, where in the earlier draft it was rejected.** The reason is `onTimeout: deny`: a declared, generated fail-closed default is a *disengage* mechanism, not merely a per-call refusal. It remains partial and DECLARES rather than ENFORCES because the enforcement lives in the customer's implementation, and because MANAGE 2.4's trigger is *demonstrated inconsistent performance* — nothing here observes performance or makes that judgement.

**MAP 3.5's "assessed" is absent.** Nothing evaluates whether the oversight process is effective, only that it is declared and non-forgettable.

### 2.3 Third party and supply chain

| Mechanism | Subcategory | Class | Grade |
|---|---|---|---|
| `allowedModelPublishers`, `onlyAllowDirectFromAzure` via Azure Policy | **GOVERN 6.1** third-party risk policies and procedures | **ENFORCES** | Partially covered |
| `new-external-tool` gate | GOVERN 6.1 | ENFORCES PROCESS | Partially covered |
| `knowledge-classification-raised` gate | **MAP 4.1** mapping legal/technology risks of components | ENFORCES PROCESS | Partially covered |
| Collector — external tool and connection drift | **MANAGE 3.1** third-party risks monitored, controls applied | EVIDENCES | Partially covered ⚠ |

**What is not covered.** GOVERN 6.1's IP-infringement half — roughly half its text — is untouched. GOVERN 6.2 (contingency for third-party failure) has no mechanism. MAP 4.1's legal-risk assessment is human work the gate prompts for and does not perform.

### 2.4 Security, safety and privacy — three rows the earlier draft wrongly listed as gaps

| Mechanism | Subcategory | Class | Grade |
|---|---|---|---|
| `forbidPrivilegeEscalationFromContent` + generated per-tool injection test suite; `contentSafety: required` | **MEASURE 2.7** security and resilience evaluated and documented | ENFORCES PROCESS | Partially covered |
| `onTimeout: deny`; validator R7 (no write/external tool without a gate) | **MEASURE 2.6** demonstrated safe, can fail safely | **DECLARES** | Partially covered |
| `includePromptContent: false` forced at `confidential`+; per-workspace index isolation | **MEASURE 2.10** privacy risk examined and documented | ENFORCES | Partially covered *(weakest partial in the document)* |

**MEASURE 2.7 is a real partial because a generated test suite is an evaluation artefact**, which is what 2.7 asks for and what enforcement alone does not provide. Scope: it evaluates injection resistance per tool. It does not evaluate resilience, availability, or the security of the estate as a whole.

**MEASURE 2.6 is graded DECLARES deliberately.** The subcategory says the system "can fail safely, particularly if made to operate beyond its knowledge limits." `onTimeout: deny` is exactly a fail-safe default — but it is generated into a stub the customer implements, and nothing demonstrates the failure mode was exercised.

**MEASURE 2.10 is the weakest partial here and is included with reservation.** 2.10 asks that privacy risk be *examined and documented*. Forcing prompt content out of the audit log and isolating indexes per workspace are *mitigations*, and a mitigation is not an examination. It earns partial only because `dataClassification` is a declared, versioned estate-level decision that drives the setting — which is a documented privacy decision, narrowly. **If an assessor pushes on this row, concede it.** Do not defend it.

### 2.5 Logging — the structural gap

`planHash` + `commit` + `countsAsOf`, and `git log` as the orchestration audit trail, is the most differentiated artefact in the product. **NIST AI RMF 1.0 has no subcategory for it.** Nearest anchors, both interpretations rather than matches: MEASURE 2.8 (transparency and accountability risks *examined and documented* — an assessment activity, not an artefact) and GOVERN 4.2 (documenting risks and impacts, not decisions). "Documented" appears in 40+ statements; **"documented" is not "logged"**, and this mapping does not trade on the ambiguity. Let the ISO A.6.2.8 row carry the framework claim.

### 2.6 Rejected NIST mappings

| Tempting mapping | Why rejected |
|---|---|
| Validator → **MEASURE 2.1** (TEVV test sets, metrics, tooling) | 2.1 is model-evaluation tooling. A config linter is not TEVV. |
| Collector → **MEASURE 2.4** (behaviour monitored in production) | Configuration monitoring, not behavioural. |
| Change gate → **GOVERN 1.7** (decommissioning) | No predicate fires on removal or teardown. |
| Approval record → **MANAGE 4.1** (post-deployment monitoring incl. change management) | "Change management" is one trailing item in a subcategory substantially about behavioural monitoring, appeal, override and incident response. |
| `contentSafety: required` → **MEASURE 2.11** (fairness and bias) | Content safety filters harmful output. It does not evaluate fairness or bias. Adjacent vocabulary, different control. |
| Any mechanism → **MEASURE 1.2** (control effectiveness assessed) | Nothing reports whether the gates are working. See §5. |

---

## 3. Summary

Counts are of **distinct controls**, not table rows. Each framework's buckets sum to its total.

| | ISO/IEC 42001 | NIST AI RMF 1.0 |
|---|---|---|
| Controls / subcategories | 38 | 72 |
| **Fully covered** | **0** | **0** |
| Partially covered | 20 | 15 |
| Gap (tool-addressable) | 7 | 30 |
| Out of scope (organisational) | 11 | 27 |
| **Total** | **38** | **72** |
| *Memo:* claimed only — rejected | 2 | 6 |
| *Memo:* mechanisms with no receiving control | 5 | 4 |

**20 of 38 ISO 42001 Annex A controls (53%)** and **15 of 72 NIST AI RMF subcategories (21%)** at partial. Both figures are higher than the earlier draft — three NIST rows moved out of the gap list once the real spec was read, and the data-handling and Azure Policy blocks were absent from the brief entirely.

**Neither number should be quoted alone.** Coverage is concentrated in access, configuration, change control and inventory; zero controls are fully covered; and the detection half has never run against Azure.

---

## 4. Enforcement inventory

**Tier 1 — hard enforcement.** The non-compliant state cannot exist via the governed path:

1. `governance-weakened` → block, no override *(A.2.4 · GOVERN 1.4)*
2. `local-keys-reenabled` → block, no override *(no AI-framework control; `27001:A.5.17`/`A.8.5`)*
3. `localKeysDisabled: true` const → `disableLocalAuth` at deploy *(as above)*
4. `separateProjectPerAccessPattern` + validator R5 (tightening only) + R7 (no ungated write/external tool) + tenant-mismatch refusal *(A.9.4 · A.2.4 · A.6.2.2)*
5. Azure Policy: publisher allowlist, `denyPreviewModels`, `onlyAllowDirectFromAzure` *(A.10.3 · GOVERN 6.1)* — enforced by the platform, which survives the tool being bypassed
6. `includePromptContent: false` at `confidential`+; per-workspace index isolation *(MEASURE 2.10)*

**Tier 2 — process enforcement.** Five baseline gates resolving to `humanApproval`: `widen-access`, `new-write-tool`, `new-external-tool`, `knowledge-classification-raised`, `limits-removed`.

**Tier 3 — declared, enforced elsewhere.** The runtime gate. The spec makes the requirement impossible to forget and generates a fail-closed stub; the customer implements the enforcement.

**Tier 4 — evidences.** `preview-dependency` (acknowledgement only), the entire collector, and the approval record. ⚠ **The collector has never run against Azure.**

Six hard-enforcement mechanisms, and **four of the six have no ISO 42001 or NIST AI RMF control to score them against.** That is a fact about the frameworks' maturity, not about the product — and it is the single most useful observation in this document for a client conversation.

---

## 5. Gaps

### 5.1 ISO/IEC 42001 — 7

| Control | Gap |
|---|---|
| **A.5.2 / A.5.3** Impact assessment process and documentation | No impact-assessment workflow. The *judgement* is out of scope (§6); that an assessment exists, is current, and is re-triggered on material change is exactly what a change gate could enforce and does not. |
| **A.7.4** Quality of data for AI systems | No data-quality assessment of declared sources. |
| **A.7.6** Data preparation | Not addressed. |
| **A.8.4** Communication of incidents | No incident concept. A `local-keys-enabled` finding is not an incident and no notification path exists. |
| **A.8.2** System documentation and information for users | The spec documents the estate for operators, not the system for users. |
| **A.10.4** Customers | Not addressed. |

### 5.2 NIST AI RMF — 30

The gaps cluster almost perfectly in **MEASURE: 15 of 22 subcategories are outright gaps**, and the spec reaches four (2.6, 2.7, 2.10, 3.1) at partial. The product governs *how an agent is wired*; MEASURE asks *whether the resulting system is any good*. Those are different questions and no amount of change gating touches the second.

Named individually because they get asked about:

- **MEASURE 2.11** fairness and bias — nothing. `contentSafety` is not this.
- **MEASURE 2.9** explainability — nothing.
- **MEASURE 2.5** validity and reliability — nothing.
- **MEASURE 2.12 / 2.13** environmental impact; TEVV efficacy — nothing.
- **MEASURE 1.1 / 1.2** metric selection; **control effectiveness assessed** — nothing reports whether the gates are working. For a governance product this is the most uncomfortable gap on the list.
- **MEASURE 3.3, 4.1, 4.2, 4.3** feedback, appeal, measurement efficacy — nothing.
- **GOVERN 1.5** review of the risk-management process — nothing.
- **GOVERN 1.7** decommissioning — **all 12 predicates fire on additions, escalations, widenings or enablements. Nothing gates removal or teardown.**
- **GOVERN 6.2** third-party incident contingency — nothing.
- **MANAGE 1.2 / 1.3 / 1.4** risk prioritisation, response planning, residual risk — findings carry severities; nothing prioritises, plans a response, or tracks residual risk.
- **MANAGE 2.2 / 2.3** sustaining value; response to previously unknown risk — nothing.
- **MANAGE 3.2** pre-trained model monitoring — deployments are declared; models are not monitored.
- **MANAGE 4.1 / 4.2 / 4.3** post-deployment monitoring, continual improvement, incident tracking — nothing beyond configuration drift.
- **MAP 2.2** knowledge limits; **MAP 3.3** targeted application scope — nothing.

---

## 6. Out of scope — organisational controls

A software product cannot enforce these, and claiming coverage would be the clearest possible overclaim. Both lists enumerated in full; nothing left to subtraction.

**ISO/IEC 42001 — 11:** A.2.2 AI policy · A.2.3 Alignment with other organizational policies · A.3.3 Reporting of concerns · A.4.6 Human resources · A.5.4 Impact on individuals or groups · A.5.5 Societal impacts · A.6.1.2 Objectives for responsible development · A.6.1.3 Processes for responsible design and development · A.8.3 External reporting · A.8.5 Information for interested parties · A.9.3 Objectives for responsible use

*(A.3.2 and A.10.2 are* not *here — the `unowned-workspace` finding evidences failures of both, so both are graded partial in §1.8.)*

**NIST AI RMF — 27:**

- **GOVERN (11):** 1.1 legal/regulatory · 1.2 trustworthy-AI characteristics in policy · 2.1 roles and communication lines · 2.2 training · 2.3 executive responsibility · 3.1 diverse teams · 4.1 safety-first culture · 4.2 documenting risks and impacts · 4.3 testing/incident practices · 5.1 external feedback · 5.2 feedback incorporation
- **MAP (12):** 1.1 intended purpose and context · 1.2 interdisciplinary participation · 1.3 mission alignment · 1.4 business value · 1.6 requirements elicitation · 2.1 tasks and methods · 2.3 scientific integrity and TEVV · 3.1 potential benefits · 3.2 potential costs · 3.4 operator proficiency · 5.1 impact characterisation · 5.2 stakeholder engagement
- **MEASURE (3):** 1.3 independent assessors · 2.2 human-subject evaluation · 2.8 transparency and accountability risks
- **MANAGE (1):** 2.1 non-AI alternatives

---

## 7. Findings worth carrying into any framework conversation

1. **Four of six hard-enforcement mechanisms have no AI-framework control.** Local-key disablement, the tenant guard, prompt-content minimisation and index isolation are the most demonstrable things in the product, and ISO 42001 and AI RMF have nowhere to receive them. They belong to ISO 27001. Lead with the demo; place it in 27001.

2. **AI RMF cannot express what this product is best at.** No subcategory contains the words access, approval, logging or traceability. The plan-hash record maps to nothing cleanly. Saying so is credible; mapping it to MEASURE 2.8 is not.

3. **MEASURE is nearly empty, permanently.** 15 of 22 gaps. This is a boundary of the product category, not a backlog item — and stating it before a client finds it is worth more than the coverage it costs.

4. **Nothing gates removal.** All 12 predicates fire on widening. GOVERN 1.7 and part of the lifecycle are uncovered.

5. **The recursive-prefix hole is the most under-appreciated risk in the spec.** A signed knowledge mapping silently stops being true as folders appear beneath an approved prefix. The spec identifies this itself and proposes a re-survey cadence; until that exists, A.7.3/A.7.5 coverage degrades with time rather than staying constant.

6. **`tools[].effect` is a single-field integrity dependency.** Understating it skips both gates. No technical mitigation exists — only a review habit.

7. **Detection has never met Azure.** Six drift findings out of seventeen carry documented false-negative or join-ambiguity risk (`BLOCKERS.md` #1, #3, #4). `FIXTURES.md` step 9 — *"Re-run everything with all fixtures removed. Expect zero findings"* — is the single most valuable unfinished item in the project, because absence of false positives is what a client tests you on.

8. **`preview-dependency` only records.** One of the eight baseline gates is `acknowledgement`. Do not let "eight gates" imply eight approvals.

---

## 8. Before this leaves the building

1. **Run `FIXTURES.md`.** `BLOCKERS.md` #1 is now "needs an afternoon" rather than "needs a client" — Scott has an Azure subscription. Until step 9 passes, every ⚠ row is design confidence, not evidence.
2. **Read the tool source.** Rule counts and content here come from `tool-notes/README.md`, not from `spec/validate.ts` and `rules.ts`. Verify the 12 and the 15 against code, and map each rule individually.
3. **Resolve blocker 3** (the agents data-plane/ARM join). The access column of the map is wrong for exactly the workspaces configured most carefully, which is the worst possible distribution of error.
4. **Decide on the knowledge-mapping sign-off gate.** `09-preflight-and-signoff.md` proposes it with a client-side approver and `countsAsOf`; it is not in `estate.yaml`. It is the gate that most directly serves A.7.3 and MAP 4.1, and it is the one a client signs.
5. **Decide on R13** (no external principals in `sg-ai-*` groups). Offered, not accepted.
6. **Add a decommissioning predicate, or record the decision not to** (§7.4).
7. **Have someone with a licensed ISO copy** check the title variants in §0.3 and confirm A.9.5 does not exist.
