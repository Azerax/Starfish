# Embedding Starfish - Risk Register

Risks of importing Starfish as a governance layer into a host platform (CLI skills or a custom React
dashboard), per docs/EMBED_INTEGRATION_PLAN.md. Scoring: Likelihood (L) and Impact (I) each Low /
Med / High. Priority = L x I. Mitigations are concrete and mapped to the plan's phases where relevant.

Legend: L/I in {Low, Med, High}. "Floor" = the non-lowerable system-risk floor.

## A. Security and trust boundary

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 1 | Sidecar API reachable beyond loopback, exposing decisions/approvals to the network | Med | High | Bind 127.0.0.1 only; hard-refuse non-loopback binds at startup; document reverse-proxy is unsupported; conformance test asserts refusal to bind 0.0.0.0 |
| 2 | Bearer token leaks (logs, env dump, process args, screenshots) | Med | High | Token in a `0600` file under the governed root; never on argv/env/audit/logs; out-of-band handoff; rotate command; short TTL option |
| 3 | Host or local process spoofs the actor to defeat proposer != approver | Med | High | Server assigns actor identity per authenticated session/token; never trust client-claimed actor; audit the authenticated identity |
| 4 | Malicious local process posts approve/deny to the broker | Med | High | Token + loopback + per-decision nonce; approvals require the current session token; audit every resolve with source |
| 5 | Key material exfiltrated via the API (dashboard or skill asks for keys) | Low | High | No key-read endpoint exists; keys resolved host-side from OS keychain into throwaway request headers only; never returned to caller/audit |
| 6 | Prompt-injection in skill inputs escalates through the host | Med | High | Existing ingress/taint screening + deny-by-default + boundaries; treat all host-supplied content as untrusted data, not instructions |
| 7 | Sidecar unreachable and the host "fails open" (skips the gate) | Med | High | Fail-closed client contract: no decision => deny; SDK/middleware deny on timeout; conformance test kills the sidecar mid-call and asserts denial |
| 8 | Host tampers with audit.jsonl (it can touch the governed root on disk) | Med | High | Hash-chain verification on read; restrictive perms; optional external anchoring of roots; self-integrity check + drift -> safe mode |
| 9 | TOCTOU: host gets an allow, then mutates the call before executing | Med | High | Bind each decision to a hash of the exact call + a nonce; PEP re-checks at execution; short-lived decision tokens |
| 10 | A compromised skill edits `.starfish/` to downgrade governance | Low | High | `.starfish` is a boundary deny subtree (agents cannot write it); governed-projects registry; verify-before-invoke integrity gate |
| 11 | Replay of a previously approved decision to run a new action | Low | Med | One-shot decision nonces; resolved decisions are deleted, not reusable; audit shows single consumption |

## B. Governance integrity (the product's whole point)

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 12 | Host ships permissive default policies, eroding deny-by-default | Med | High | Seed ships deny-by-default; host cannot lower the Floor; policy diff review; `doctor` flags weakened policy |
| 13 | proposer != approver collapses (same identity proposes and approves) | Med | High | Distinct actor identities across the boundary; server rejects self-approval; audit both actors |
| 14 | Version skew between engine and host wire protocol silently bypasses checks | Med | High | Wire-version handshake on every session; refuse on mismatch (fail-closed); semver the protocol |
| 15 | Host sets an over-broad write boundary (e.g. home or system root) | Med | High | Validate roots at init; refuse/warn on home/system/drive roots; scaffold per-skill boundaries; `doctor` warning |
| 16 | Alarm fatigue: routine denials treated as anomalies (already hit once) | Low | Med | Denials are informational; only genuine anomalies (boundary/hash/budget/orphan) alarm; keep signal quality high |
| 17 | Approval fatigue leads to rubber-stamping | Med | Med | Clear per-ask reasons; writes=auto + backups for in-boundary writes; per-project confidence level; batch related asks; never auto for Floor |
| 18 | Cost controls are theater (host relies on Starfish to cap a platform-limited key) | Low | Med | Explicit platform-managed vs local-cap modes; document that Starfish cannot raise a provider's own limit |

## C. Architecture and coupling

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 19 | Electron/CLI coupling leaks into the embeddable SDK (cannot run headless) | Med | High | Extract `@starfish/sdk` with zero Electron in its dep graph; enforce with the dependency-direction lint; CI check |
| 20 | React components too coupled to app internals (preload, theme) to embed | Med | Med | Reuse the existing `getBridge()` seam; add `httpBridge`; theme passed as prop; publish `@starfish/ui` with a headless story |
| 21 | Per-call PDP over HTTP adds latency to skill runs | Med | Med | In-process SDK for hot paths; local unix socket / named pipe option; keep decisions cheap; no network on the decision path |
| 22 | Multi-root confusion for a host with many skill repos | Med | Med | One Governor per governed root; one sidecar per root or a root-routing front; document the model; refuse ambiguous root |
| 23 | Public API surface unstable, breaking hosts on upgrade | High | Med | Define and freeze a public surface; mark everything else internal; semver; deprecation policy; typed contracts + changelog |
| 24 | Circular/deep package deps complicate publish and bloat hosts | Low | Med | Ring layering enforced by lint; tree-shakeable ESM; no ring-1 dep on ring-3 |

## D. Distribution and supply chain

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 25 | Host trusts a compromised Starfish npm release | Low | High | npm provenance/signing; publish from CI only; SBOM (scripts/sbom.mjs); integrity manifest; pin + verify |
| 26 | Release hygiene bugs ship broken artifacts (stale-cache/amend issues already hit) | Med | Med | release.ps1 gates on install+test+build; never amend a pushed commit; tag == tested commit; green CI required |
| 27 | esbuild/vitest native-binary portability breaks builds on some hosts | Med | Med | CI build/test matrix; ship a prebuilt CLI bundle; document supported Node/OS; avoid host-side rebuild where possible |

## E. Operational

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 28 | Sidecar lifecycle problems (crash, orphan, port/pipe conflict) | Med | Med | Single-instance lock; health endpoint; supervised restart; host fails closed while down; clear stale sockets on boot |
| 29 | Unbounded audit.jsonl growth degrades the host | Med | Low | Size-based rotation with chained roots; retention policy; optional anchoring of rotated segments; compaction tooling |
| 30 | Secret sprawl: provider keys stored in several host locations | Med | Med | Single keychain-backed resolver; Toby as the only .env gatekeeper with content screening; never commit .env; rotate on exposure |

## F. Sidecar API and protocol

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 31 | No rate limiting -> local DoS / audit flooding by a runaway skill | Med | Med | Per-token rate limits + backpressure; sample repeated identical denials in audit; circuit-break abusive callers |
| 32 | Oversized/unvalidated request bodies OOM or crash the sidecar | Med | Med | Strict schema validation; body size caps; reject unknown fields; fail-closed on parse error |
| 33 | SSE stream leaks paths/content to any connected dashboard client | Med | Med | Minimal event payloads; redact secrets/paths; scope events to the authenticated session |
| 34 | API error messages disclose internal paths/config | Med | Low | Generic error envelopes to callers; full detail only in the audit log |
| 35 | SSE/long-poll connection exhaustion (fd leak) | Low | Med | Connection caps, idle timeouts, heartbeats; drop dead clients |
| 36 | Clock skew corrupts decision TTL / nonce windows | Low | Med | Server-authoritative time; monotonic nonces; never trust client clocks |

## G. Data, privacy, and compliance

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 37 | Skill content in audit reason fields becomes a PII/secret sink | Med | High | Secret-scan + redact before audit; store hashes/refs, not raw content; retention policy |
| 38 | Append-only audit conflicts with GDPR/CCPA deletion rights | Low | Med | Store payload references; support crypto-shredding of payloads while preserving the chain; documented policy |
| 39 | Cross-tenant data bleed when one sidecar serves multiple roots | Low | High | One Governor per governed root; hard isolation; no shared caches across roots |
| 40 | Pre-image backups retain secrets later removed from a file | Med | Med | Secret-scan backups; encrypt/lock the backup dir; exclude secret paths; purge policy |
| 41 | Added telemetry/analytics exfiltrates governance data | Low | High | No default telemetry; opt-in only; local-only; documented; no external egress on the decision path |

## H. Concurrency and state

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 42 | Two approvers resolve the same pending decision at once | Med | Med | Atomic compare-and-set on resolve; first wins; audit the rejected resolve |
| 43 | Concurrent writers corrupt the hash-chained audit | Med | High | Single writer (the sidecar owns audit); append lock; all others write via the API |
| 44 | Multi-write in one run reuses a broker refId, orphaning a waiter (already flagged) | Med | Med | Per-call refId + unique nonce per tool call; do not dedupe distinct calls |
| 45 | State files partially written on crash (providers/secrets/onboarding) | Med | Med | Atomic temp-file + rename; fsync; schema-validate on load; fail-closed on corrupt |
| 46 | Governed root on cloud-synced/network FS corrupts state (already hit: git index) | Med | High | Warn against OneDrive/network FS for the root; detect + repair; document supported filesystems |

## I. Skill lifecycle and vetting

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 47 | Skill changes after vetting but runs with stale trust (TOFU) | Med | High | Pin content hash; re-vet on manifest change; integrity gate denies drift and quarantines |
| 48 | Transitive skill dependencies pull ungoverned code | Med | Med | Vet the full file manifest; boundary confinement; no network by default |
| 49 | Skill escapes its boundary via symlink/junction | Low | High | Existing symlink rejection + realpath; deny Windows junctions; tests per OS |
| 50 | Skill uses an unregistered tool name to slip past mapping | Low | High | Unknown tool -> default-deny; taxonomy allowlist; audit unmapped attempts |
| 51 | A host bug auto-enables quarantined (Medium+) skills | Low | High | Consent state enforced server-side; UI cannot flip it without the operator; audit consent changes |
| 52 | Compromised skill source/marketplace delivers a poisoned pack | Low | High | Source registry + signature verification; blocklist; publisher pinning |

## J. Model and provider runtime

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 53 | Model emits malformed tool JSON -> crash/unhandled path | Med | Med | Safe parse (present); parse failure -> deny/no-op; bounded retries |
| 54 | Provider API change breaks the adapter (as the tool-name 400 did) | Med | High | Adapter conformance tests; pin provider version headers; surface errors, fail-closed |
| 55 | Model loops to max-steps, burning tokens without progress | Med | Med | No-progress detection (present); max-steps cap; token governor; per-run ceiling |
| 56 | Tool-result content injection: model treats output as new instructions | Med | High | Egress containment; frame results as data; taint propagation |
| 57 | Router downshifts to a model lacking tool support, breaking runs | Low | Med | Capability-aware routing; validate tool support; safe fallback rules |
| 58 | Non-deterministic model output makes runs hard to audit | Low | Low | Decisions are policy-driven and deterministic; model output stored as data with inputs |

## K. Dashboard and embeddable UI

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 59 | Embedded components clash with host CSS/global styles | Med | Med | Scoped styles / optional shadow DOM; namespaced classes; theme tokens as props |
| 60 | httpBridge polling hammers the sidecar / stale views | Med | Med | Prefer SSE push; ETag + backoff; multiplex a single subscription |
| 61 | Dashboard shows stale pending approvals after resolution elsewhere | Med | Med | SSE invalidation; optimistic update + server reconcile; server is source of truth |
| 62 | XSS via unsanitized audit/reason strings rendered in the host | Low | High | Escape by default; never dangerouslySetInnerHTML on governance data |
| 63 | UI package pulls the whole engine into the browser bundle | Low | Med | UI depends only on the contract + httpBridge, never governance-core |

## L. Human factors and organization

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 64 | Single operator is an approval bottleneck / SPOF | Med | Med | Multiple approver identities; delegation; escalation-timeout policy (deny on timeout) |
| 65 | Operator lacks context to judge an approval | Med | Med | Rich reason + diff/preview in the ask; risk tier; link to audit |
| 66 | Governance theater: adopted for optics, the floor quietly disabled | Low | High | Floor non-lowerable by design; doctor attests; tamper-evident audit |
| 67 | Onboarding complexity deters adoption | Med | Med | Few-liner SDK; curlable API; sane defaults; reference integrations |

## M. Legal, licensing, and brand

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 68 | A third party embeds Starfish and misrepresents its guarantees | Med | Med | TRADEMARK.md usage terms; "governed by Starfish" mark guidelines; disclaimer |
| 69 | Confusion over Apache-2.0 for commercial embedding | Med | Low | Clear COMMERCIAL.md + NOTICE + FAQ; optional commercial terms |
| 70 | Liability if a governed action causes harm (seen as a safety product) | Low | High | Explicit no-warranty; scope statement; "not a substitute for security controls"; legal review |
| 71 | Patent/IP claims over governance techniques | Low | Med | Prior-art documentation; defensive publication; counsel |

## N. Testing and observability

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 72 | Invariants regress silently without cross-mode coverage | Med | High | One conformance suite run across in-process, sidecar, and overlay; CI gate |
| 73 | Hard to debug a denial in production (opaque reasons) | Med | Med | Structured reasons + correlation ids; audit query tooling; doctor |
| 74 | No visibility into allow/deny/ask rates to tune policy | Med | Low | Local metrics derived from audit; dashboards; no external egress |

## O. Deployment environments

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 75 | Named-pipe vs unix-socket differences cause integration bugs | Med | Med | Existing transport abstraction; test both OSes; HTTP as the portable fallback |
| 76 | Containerized host cannot reach the OS keychain for keys | Med | Med | Documented key provisioning (mounted secret / keychain bridge); fail-closed if unavailable |
| 77 | Case-insensitive FS / path-separator quirks bypass boundaries | Low | High | Canonicalize + case-normalize + realpath; per-OS boundary tests |

## P. Recovery and resilience

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| 78 | Safe-mode bricks the host with no recovery path | Low | High | Safe-mode denies actions but keeps read/attest; documented `starfish attest` recovery; audited operator override |
| 79 | Corrupt governed root prevents the host from starting | Low | High | Validate on boot; guided repair/re-seed that preserves the audit chain; config backups |
| 80 | Silent partial upgrade (engine upgraded, policies not migrated) | Med | High | Schema/version stamp on the root; migrate on load; refuse mismatched schema (fail-closed) |

## Top 5 to address first
1. #7 fail-closed on sidecar-down (a governance layer that fails open is worse than none).
2. #14 wire-version handshake (a silent bypass defeats the product).
3. #3 / #13 server-side actor identity so proposer != approver survives the boundary.
4. #19 headless SDK extraction (unblocks every in-process host and prevents Electron leakage).
5. #23 frozen public API + semver (hosts will not adopt a surface that breaks each release).

## Cross-cutting controls
- A single conformance suite that runs the same deny/ask/approve/fail-closed scenarios across all three
  integration modes (in-process, sidecar, overlay), so an invariant proven once holds everywhere.
- `starfish doctor` extended to audit an embedded deployment (loopback-only, token perms, wire version,
  boundary sanity, deny-by-default policy, audit chain intact).
