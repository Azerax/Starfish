# Embedding Risk Heat Map

Derived mechanically from docs/EMBED_RISK_REGISTER.md (all 80 risks bucketed by Likelihood x Impact). Rows = Likelihood (top = most likely), Columns = Impact (right = most damaging). Read the top-right cell first.

## Grid (risk IDs)

| Likelihood \ Impact | Low | Med | High |
|---|---|---|---|
| **High** | - | #23 | - |
| **Med** | #29 #34 #69 #74 | #17 #20 #21 #22 #26 #27 #28 #30 #31 #32 #33 #40 #42 #44 #45 #48 #53 #55 #59 #60 #61 #64 #65 #67 #68 #73 #75 #76 | #1 #2 #3 #4 #6 #7 #8 #9 #12 #13 #14 #15 #19 #37 #43 #46 #47 #54 #56 #72 #80 |
| **Low** | #58 | #11 #16 #18 #24 #35 #36 #38 #57 #63 #71 | #5 #10 #25 #39 #41 #49 #50 #51 #52 #62 #66 #70 #77 #78 #79 |

## Counts

| Likelihood \ Impact | Low | Med | High | row total |
|---|---|---|---|---|
| **High** | 0 | 1 | 0 | 1 |
| **Med** | 4 | 28 | 21 | 53 |
| **Low** | 1 | 10 | 15 | 26 |
| **col total** | 5 | 39 | 36 | 80 |

## Priority tiers (score = L x I, Low=1/Med=2/High=3)

- **P0 - do first (High x High = 9)** (0): 
- **P1 - next (score 6)** (22): #1, #2, #3, #4, #6, #7, #8, #9, #12, #13, #14, #15, #19, #23, #37, #43, #46, #47, #54, #56, #72, #80
- **P2 - scheduled (score 3-4)** (43): #5, #10, #17, #20, #21, #22, #25, #26, #27, #28, #30, #31, #32, #33, #39, #40, #41, #42, #44, #45, #48, #49, #50, #51, #52, #53, #55, #59, #60, #61, #62, #64, #65, #66, #67, #68, #70, #73, #75, #76, #77, #78, #79
- **P3 - watch (score <=2)** (15): #11, #16, #18, #24, #29, #34, #35, #36, #38, #57, #58, #63, #69, #71, #74

> Note: **P0 (High x High) is intentionally empty.** For a pre-release governance layer nothing is both near-certain and catastrophic - the most damaging risks (audit tamper, fail-open, key exfil, actor spoof) are Med-likelihood because they have real mitigations. Treat the **P1 / Med x High cluster as the build-first tier**; the implementation plan narrows it to a strategic first wave.

## P0 and P1 detail (the build-first set)

| # | L | I | Risk |
|---|---|---|---|
| 1 | Med | High | Sidecar API reachable beyond loopback, exposing decisions/approvals to the network |
| 2 | Med | High | Bearer token leaks (logs, env dump, process args, screenshots) |
| 3 | Med | High | Host or local process spoofs the actor to defeat proposer != approver |
| 4 | Med | High | Malicious local process posts approve/deny to the broker |
| 6 | Med | High | Prompt-injection in skill inputs escalates through the host |
| 7 | Med | High | Sidecar unreachable and the host "fails open" (skips the gate) |
| 8 | Med | High | Host tampers with audit.jsonl (it can touch the governed root on disk) |
| 9 | Med | High | TOCTOU: host gets an allow, then mutates the call before executing |
| 12 | Med | High | Host ships permissive default policies, eroding deny-by-default |
| 13 | Med | High | proposer != approver collapses (same identity proposes and approves) |
| 14 | Med | High | Version skew between engine and host wire protocol silently bypasses checks |
| 15 | Med | High | Host sets an over-broad write boundary (e.g. home or system root) |
| 19 | Med | High | Electron/CLI coupling leaks into the embeddable SDK (cannot run headless) |
| 23 | High | Med | Public API surface unstable, breaking hosts on upgrade |
| 37 | Med | High | Skill content in audit reason fields becomes a PII/secret sink |
| 43 | Med | High | Concurrent writers corrupt the hash-chained audit |
| 46 | Med | High | Governed root on cloud-synced/network FS corrupts state (already hit: git index) |
| 47 | Med | High | Skill changes after vetting but runs with stale trust (TOFU) |
| 54 | Med | High | Provider API change breaks the adapter (as the tool-name 400 did) |
| 56 | Med | High | Tool-result content injection: model treats output as new instructions |
| 72 | Med | High | Invariants regress silently without cross-mode coverage |
| 80 | Med | High | Silent partial upgrade (engine upgraded, policies not migrated) |
