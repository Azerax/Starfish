# Autonomous session worklog

Start **02:21:54 UTC** · target end **04:40:54 UTC** (139 min)

> Correction at 02:26: the first version of this log had estimated timestamps
> rather than measured ones — I wrote forward guesses (02:31, 02:46, 03:08…)
> while only four minutes had actually elapsed. Rewritten with real clock
> readings; every row below is `date -u` at the moment the item finished.

| Time (UTC) | Elapsed | Item |
|---|---|---|
| 02:21 | 0:00 | Session start. Toolchain fixed: Node 22 + tsx + TypeScript, no build step, runs under Windows/PowerShell. |
| 02:26 | 0:04 | Core built: `model.ts`, `spec/load.ts`, `spec/validate.ts`, `spec/intended.ts`, `collect/types.ts`, `actual.ts`, `diff.ts`. Notes on each below. |

### 02:26 — design decisions in the first block

- **`model.ts`** — intended and actual graphs share one shape, so the diff is a
  set operation, not a translation. Deterministic ids (`nid`/`eid`) are
  load-bearing: if the two sides disagree on an id, the diff invents a spurious
  planned+undeclared pair instead of a match.
- **`spec/validate.ts`** — 12 rules, not the 8 from GOVERNANCE.md. Added
  dangling references (R9), shared index across workspaces (R10), shared group
  (R11), implicit downstream grant (R12). Every issue carries a `fix`; an error
  a human can't act on is a bug report.
- **`spec/intended.ts`** — tools keyed **per workspace**, not globally.
  `matter-lookup` on legal-research is a different binding from the same name on
  hr-assist: different managed identity, different grants, different blast
  radius. Collapsing them hides the thing the map exists to show.
- **`collect/types.ts`** — four sources normalise into one flat observation set,
  so nothing downstream knows whether data came from a live API or a fixture.
  `classifyScope()` parses raw ARM scope paths, because scope *kind* is what
  decides least-privilege vs over-broad.
- **`actual.ts`** — two judgement calls. (1) An account-scoped grant is **fanned
  out** to every project on the resource; drawing only the assignment would
  understate blast radius, and over-privilege is exactly what the map should
  make obvious. (2) `inferEffect()` guesses tool effect from name/type/endpoint,
  because a tenant records what a tool *is*, never what it is *for*.
  Deliberately pessimistic, and always flagged `effectInferred` so a guess is
  never mistaken for a declaration.
- **`diff.ts`** — added `Conflict` to the model. A node can be a "match" and
  still be wrong: scope drift is the canonical case — the workspace exists
  exactly as designed except the grant landed at account scope. Same id both
  sides, so it matches, and the conflict *is* the finding. The diff throws on
  dangling edges rather than rendering a line to nowhere.

| 02:31 | 0:09 | `cli.ts` + `render.ts` + replay collector + `fixtures/contoso/observations.json`. Pipeline runs end to end: spec + fixture → intended graph → actual graph → diff → rules → report. Typecheck clean. |
| 02:32 | 0:10 | **Bug 1 (dropped edges).** Agent-to-agent edges were silently lost when the peer appeared later in the array — a single pass over `obs.agents` built the edge before the target node existed. Split into two passes: all agent nodes, then all agent edges. This was dropping exactly the orchestration chain the rules most want to see. |
| 02:32 | 0:10 | **Bug 2 (misleading count).** Scope drift reported "5 workspaces granted at a wider scope than designed" from a *single* account-scoped assignment fanned out across 5 projects. Reads as five misconfigurations when there is one. Now counted by grant, with blast radius in the detail: "1 group is granted at account scope — sg-ai-hr-assist reaches 5 workspaces." |
| 02:33 | 0:11 | **Bug 3 (false positive) — the important one.** The spec says `agentApplication`; ARM classifies the same assignment as `agent`. The differ compared raw strings and reported a conflict on *every correctly configured workspace* — 3 false positives out of 4 grants. Added `canonicalScope()` in the model; both builders normalise through it so the diff compares meaning, not vocabulary. A false positive in a tool you show a client is worse than a miss: it costs you the room. |
| 02:34 | 0:13 | Test suite: **48 tests, all passing**, typecheck clean. Covers all 12 validator rules, the diff at both extremes (empty spec / empty tenant / self-diff idempotence), effect inference, and every drift rule. Three tests are explicit regressions for the bugs above. One test caught a bad *test* rather than bad code: R3 asserted a ceiling breach with 6 indexes against a 15-index tier. |
| 02:35 | 0:13 | **Bug 4 (wrong semantics).** Selecting any workspace lit 36 of 44 edges. `reach()` was a transitive graph walk, and one account-scoped grant links a group to every project on the resource — so walking transitively from anywhere lights the whole estate and answers nothing. Rewrote it as a bounded *neighbourhood* expressed in columns rather than hops: who grants this, and what does it reach. Selecting a right-column node deliberately does not fan back out into sibling resources — the question there is "who uses this", not "what else exists". |
| 02:36 | 0:14 | Verified selection semantics: marketing-copy lights 10 nodes, legal-research 9, frontier-chat 8 (its consumers). `sg-ai-hr-assist` still lights 33 of 45 — correct, and the point: it holds an account-scoped grant, and the map making that obvious is the whole argument for drawing this. |
| 02:37 | 0:15 | Built `tools/synth.ts` — synthetic estate generator with configurable drift, so the stress test runs the real pipeline rather than a hand-built worst case. Generated 40- and 120-workspace estates. |
| 02:38 | 0:16 | **Stress test found the real scaling failure.** At 120 workspaces the map drew 1,319 edges and was an unreadable hairball, and *every* workspace carried a warning marker. Both had the same root cause: a dozen account-scoped grants each fanning out to all 110 projects. Two fixes — (1) rules now mark the granting *group*, not every workspace it happens to reach, since a marker on all 110 means nothing; (2) render suppresses fan-out edges above 4 and puts the count on the group instead ("account scope · reaches 110"), drawing the lines only when that group is selected. The number is the finding; the lines are just its evidence. Edges drawn: 1,319 → 109. |
| 02:38 | 0:17 | Measured load properly: the 14-second page load was the Google Fonts fetch timing out in an offline sandbox, not rendering. With the font host blocked, a 713-node / 1,909-edge estate loads in **729 ms**. Worth knowing the font link is the slowest thing on the page when a client opens it on a locked-down network. |
| 02:53 | 0:31 | API-surface research came back and **contradicted three things I had assumed**, all worth writing down before the collectors get built on them. |

### 02:53 — what the API research changed

1. **Azure Resource Graph cannot see Foundry projects.** Only `microsoft.cognitiveservices/accounts` is in ARG's `resources` table; `accounts/projects` and `accounts/deployments` are not. So ARG is good for the account sweep only, and everything below that is per-account ARM paging. That is a real cost difference on a large tenant and it changes the collector's shape.
2. **MCP tools carry `require_approval` in the tenant, defaulting to `"always"`.** `actual.ts` was asserting `gated: false` for every observed tool with the comment "a tenant cannot tell us a gate exists; only the spec can". That comment is wrong. The tenant *can* tell us, for MCP tools, and treating a genuinely-approval-gated tool as ungated is a false positive — the exact class of error that costs you the room.
3. **Draft agents are excluded from `GET /agents` by default.** Published versions get integer versions; drafts get `draft-{timestamp}` and only appear with `include_drafts=true`. Since "undeclared workspace" is the headline finding, a scan that silently misses draft agents *understates* the thing the tool exists to find. The collector must pass the flag and the report must say when it could not.

Also useful: agents expose `instance_identity.principal_id`, which joins an agent back to its role assignments; `allowed_tools` omitted on an MCP binding means every tool on that server is exposed; and `Azure AI Developer` is now deprecated for Foundry, so an assignment of it is itself a finding.
| 02:55 | 0:33 | Rebuilt the gating model on the research. `observedGate()` reads MCP `require_approval` (defaulting to "always") and returns **undefined** for every other tool type, because the tenant genuinely cannot say. Rules split accordingly: confirmed-ungated is high severity and a fact; unconfirmable is medium and phrased as a question to ask, not a defect to report. Accusing a tool that is actually gated in the calling app is how a report loses the room. |
| 02:55 | 0:34 | **Bug 5 (over-calling).** `inferEffect()` matched the whole endpoint URL against a pattern containing `http` — so every `https://` tool came back "external" and the external count meant nothing. Now matches the name and type, plus the endpoint's *hostname* against known external services. Regression test added. |
| 02:55 | 0:34 | Added `caveats` to the collector contract and a `scan-incomplete` rule that always sorts first: a partial scan that looks complete is worse than no scan. Every count below it is a floor, not a total. Also added rules for unrestricted MCP bindings (no `allowed_tools` = whatever that server adds tomorrow) and for roles Microsoft has deprecated for Foundry. |
| 02:58 | 0:36 | Wrote the four live collectors — `arm.ts`, `graph.ts`, `foundry.ts`, `search.ts` — plus `auth.ts` and `run.ts`. Zero dependencies: tokens come from `az account get-access-token` rather than `@azure/identity`, because the person running this has just done `az login` against a client tenant and the CLI already handles device code, MFA and tenant switching. |
| 02:59 | 0:37 | Wired live scan into the CLI (`estate scan --tenant --subscription`). Collector-specific defaults that matter: Search reads at `2026-05-01-preview` because `permissionFilter` is **absent, not null**, at the stable version — a stable-version scan would report every shared index as dedicated, a false negative on the finding the design most wants to catch. Foundry passes `include_drafts=true` for the same reason. |
| 02:59 | 0:38 | `test/collectors.test.ts` — 20 more tests on the parsing half of the collectors, which is where the risk is and which runs fine without a tenant. Deliberately no HTTP mocks: a mock built from my own reading of the docs would assert my assumptions back at me and produce false confidence. **82 tests total, all passing.** |
| 03:00 | 0:38 | Regenerated the Contoso map from the live pipeline — 48 nodes, 47 edges, 16 findings. Verified in light and dark, no console errors, no body overflow, detail panel and finding-to-map highlighting both working. |
| 03:01 | 0:39 | `BLOCKERS.md` — four blockers, five scored solutions each. Blocker 1 (no tenant, so no collector has ever run) is the only one that stops the project; blockers 2 and 3 are answerable in the same sitting once a trial tenant exists. |
| 03:02 | 0:40 | Built two of the mitigations from `BLOCKERS.md` rather than only recommending them. `--record <dir>` captures every raw API response from a live run as a permanent fixture, with GUIDs pseudonymised on write and anything credential-shaped redacted — a recording is a fixture that may end up in a repo, not an export of a client's tenant. `estate preflight` checks all four permission paths against the same endpoints the collectors use, and prints what to ask for in the words a client's admin will recognise. |
| 03:02 | 0:41 | Routed every collector through one `rfetch()` so recording captures the whole scan rather than whichever calls someone remembered to instrument. Verified: no raw `fetch(` remains outside that wrapper. Preflight smoke-tested with no credentials — fails cleanly with an actionable message rather than a stack trace. |
| 03:03 | 0:41 | `README.md` — architecture, the four collectors and why each cannot be skipped, and the eight decisions worth not relitigating. |
| 03:04 | 0:42 | Delivered the tool, blockers and worklog; republished the map generated from the real pipeline. |
| 03:04 | 0:43 | **Tested the primary use case and it reads wrong.** The first engagement is a scan of a prospect with *no spec at all*, and in that mode the report says "6 workspaces exist that no spec claims", "7 indexes added by hand", and "the design forbids shared stores" — when there is no spec and no design. Every drift-relative finding degenerates into noise, and the stat labels all presuppose a design. Findings that are absolute (ungated tools, key auth, permission filters, orphan groups, direct grants) are still correct; findings that are relative to a design are not. Splitting the report into discovery and diff modes. |
| 03:06 | 0:45 | Split the report into **discovery** and **diff** modes. Discovery suppresses the four drift-relative rules rather than rewording them, swaps the stat row for an inventory (workspaces / agents / ungated tools / groups at account scope / agents driving agents), retitles the page, and reduces the legend to one line. Absolute findings — key auth, ungated tools, permission filters, account-scope grants, agent chains, unresolved principals — are unchanged, because they never depended on a design. |
| 03:06 | 0:45 | **Bug 6, found while fixing that.** Filtering findings after the fact left their `mark()` side effects behind, so discovery mode painted 22 of 44 nodes red for drift it had deliberately stopped reporting. Marks are now *derived* from surviving findings rather than set while a rule runs, with an optional `mark` field for the case where the highlight set and the marker set legitimately differ. Red nodes in discovery: 22 → 14, and each one now traces to a finding the report actually contains. |
| 09:42 | — | **Timing correction.** The session was suspended and resumed; wall clock now reads 439 minutes against a 139-minute window. Actual working time before the gap was about 45 minutes. Everything above 03:07 is post-resume, and the elapsed column stops being meaningful there. Recording it rather than back-filling plausible numbers. |
| 09:42 | — | `estate summary` — the same report as markdown. The map is what you show on a call; this is what goes in the email afterwards. Leads with the caveats deliberately: a scan emailed to a client outlives the conversation where you explained its limits, so the limits travel with it. Account-scope grants are labelled in the inventory table, otherwise one grant appears in every row and reads as six deliberate ones. **95 tests, all passing.** |
