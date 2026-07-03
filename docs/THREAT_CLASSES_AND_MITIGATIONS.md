# Threat Classes and Systematic Mitigations (2026-07-03)

Generalizes docs/CODE_AUDIT.md from 26 point findings into the underlying threat classes, so a single
mitigation + guardrail closes the whole surface (present and future) rather than one instance. Each class
lists the audit findings it covers (A-IDs), the root cause, the systematic mitigation (design rule), and
an ENFORCEABLE guardrail (a lint or conformance test that fails if the class reappears anywhere).

Principle running through all of them: **deny-by-default and fail-closed must be the behavior on the
unexpected path, not just the expected one.** Most findings are cases where an *unusual* input shape,
platform, or ordering slipped past a check that only anticipated the usual one.

## Class 1 - Inconsistent normalization (compare one form, act on another)
Findings: A1 (case-exact boundary), A10 (TOCTOU check-vs-use), M5/deletion raw path.
Root cause: paths/identifiers are normalized differently (or not at all) at the check site vs the use
site, and per-platform semantics (case-insensitive Win/mac FS, Unicode, 8.3 names, trailing slash) are
ignored.
Systematic mitigation: ONE `canonicalize(path)` used everywhere (boundary, deletion, secrets, executor)
that lowercases on win32/darwin, NFC-normalizes Unicode, resolves symlinks, and strips trailing sep;
security decisions and the subsequent IO operate on the SAME canonical value (open the returned fd, do
not re-resolve).
Guardrail: (a) a conformance test that feeds `containCheck` mixed-case + Unicode + trailing-slash + `..`
variants of an in/out-of-boundary path and asserts identical verdicts on all platforms; (b) a lint that
flags direct `===`/`startsWith` comparisons of `req.*`/`input.*` path strings outside `canonicalize`.

## Class 2 - Trusting the shape of untrusted structured input
Findings: A3 (egress scans only `result`), A4 (secret screened only if `content`), A5/A24 (policy
resource = first string / lost Grep target), A6 (`/v1/decisions` spreads client body).
Root cause: code reads a specific key / positional value from an attacker-influenced object, or spreads
the whole object, instead of validating against a declared schema and deriving meaning from trusted
metadata.
Systematic mitigation: validate every external object at the trust boundary against an allowlist schema
(reject unknown fields, enum-check `riskTier`, etc.); scan ALL string fields for secrets, not named ones;
derive path/resource from the tool's declared `pathParams`, never "first string"; never `{...clientBody}`
into a trusted record - construct it field by field with server-owned values (actor, refId, riskTier).
Guardrail: (a) a shared `validate(schema, body)` helper + a test that unknown/extra fields are rejected
on every sidecar POST; (b) a test that egress containment catches a secret placed under an arbitrary key;
(c) a test that policy `resource` equals the `pathParams` value even when other string inputs precede it.

## Class 3 - Denylists (blocklists are bypassable by construction)
Findings: A7 (catastrophic-shell regex gaps), A8 (`net` any-URL), A22 (heuristic injection screens).
Root cause: enumerating "bad" inputs; attackers enumerate the complement (flag reordering, long-form,
alternate interpreters, paraphrase, internal IPs).
Systematic mitigation: prefer ALLOWLISTS at the security boundary (net destination allowlist + deny
RFC1918/loopback/metadata by default; shell command/binary allowlist); keep denylists only as
belt-and-suspenders ATOP an allowlist or an `ask`, always normalize the input before matching, and treat
them as heuristics not guarantees (the deterministic monitor `reconcile` is the real backstop).
Guardrail: a bypass-corpus test - a fixed list of known-evasive strings (`rm -fr /`, `rm --recursive
--force /`, `curl x | python`, `http://169.254.169.254`, `http://127.0.0.1`) that MUST be denied/asked;
adding a new denylist without a corpus entry fails review.

## Class 4 - Fail-open on missing / malformed / oversized input
Findings: A11 (unbounded body), A15 (usage parse -> 0 cost), A16 (torn audit line throws), M3 (bad JSON
-> `{}`).
Root cause: absence or malformation is treated permissively (empty, zero, or an uncaught throw) instead
of as a denial or a conservative estimate.
Systematic mitigation: bound all inputs (body size caps, timeouts); wrap every parse and on failure
either deny or use a conservative worst-case (non-zero cost estimate); a torn audit tail enters
deliberate safe-mode with a Critical event, never an uncaught exception; unknown -> deny.
Guardrail: tests that (a) an over-cap body returns 413 and does not OOM; (b) a 200 response with
unparseable usage still advances the TokenGovernor; (c) a truncated audit file boots into safe-mode (not
a crash) and `verify()` reports false.

## Class 5 - "Local == trusted" assumptions
Findings: A2 (.env on disk), A12 (no Host-header check), A13 (token-file perms), A20 (agent-vs-agent
approve), A21 (guessable decision ids).
Root cause: co-resident local processes and browser-origin requests are treated as trusted because they
reach loopback; secrets at rest and approver identity are under-protected.
Systematic mitigation: treat every local caller as adversarial - bearer token remains the barrier, plus
`Host`/`Origin` validation, per-source attempt throttling, and unguessable ids (`randomUUID`); secrets
at rest are created `0600` + Windows ACL (not chmod-after-write); approver must be an OPERATOR principal
(a set), not merely "not the proposer"; keep live secrets out of the tree (only `.env.example`) and
scan for them pre-commit.
Guardrail: (a) doctor FAILS (not warns) on group/world-readable token files; (b) a test that a request
with a foreign `Host` header is rejected; (c) a pre-commit / CI secret-scan over the working tree; (d) a
broker test that a non-operator principal cannot approve.

## Class 6 - Defense-in-depth not applied at every ring
Findings: A4/M4 (executor skips secret checks), A10 (executor re-derives path), A23 (`git add -A`
+`--no-verify`).
Root cause: ring-3 PEPs trust ring-1 for checks they should re-apply, so any future direct caller of the
executor (or a fast-path like `writes=auto`) bypasses them.
Systematic mitigation: the PEP re-applies the FULL check set at execution (boundary + secret-path +
canonical resolution) and acts on the validated path/fd; privileged side-effects (commit) scope their
blast radius (no `-A`, keep hooks).
Guardrail: executor conformance tests for the paths the PDP guards (symlink escape, secret read/write,
out-of-boundary) asserting the executor denies them even when handed the raw call directly.

## Class 7 - Supply-chain / layering not fully enforced
Findings: A9 (phantom deps), A19 (dep-lint misses dynamic/side-effect/require and `.tsx`).
Root cause: enforcement (manifests, lint) covers the common import form and the packages that existed
when it was written, not new forms/packages.
Systematic mitigation: every package declares its `@starfish/*` deps; the dep-direction lint matches
`import '...'`, `import ... from`, `await import(...)`, and `require(...)` across `.ts` AND `.tsx` and is
auto-derived from the workspace list (no hardcoded package roster to drift); ship provenance + SBOM; keep
the public-API-surface lock tests (already present) as the semver guard.
Guardrail: a meta-test that every `packages/*` dir is present in the dep-lint layer map (so a new package
can't silently escape layering), plus the broadened import regex.

## Class 8 - Integrity of human-facing / audit facts
Findings: A6 (spoofed risk shown to operator), A18 (failures audited as allow), L5 (inaccurate reason).
Root cause: what the operator approves and what the audit records are derived from untrusted or lossy
sources rather than authoritative server-side computation.
Systematic mitigation: the approval UI and audit show SERVER-derived facts - risk tier computed by the
PDP/RiskEngine, target from `pathParams`, outcome reflecting the real result; never display or persist
client-claimed metadata for a security decision.
Guardrail: a test that a worker-filed decision's displayed `riskTier` is the PDP-computed value, not the
client's; and that a failed `run_tests` is not audited as `allow`.

## Cross-cutting controls (close many classes at once)
- One canonicalization + one input-validation layer, used by every entry point (Classes 1, 2, 4).
- Allowlists at the boundary; denylists only as `ask`-backed belt-and-suspenders (Class 3).
- PEPs re-run the full check set on the canonical path/fd (Classes 1, 6).
- Fail-closed defaults everywhere: unknown/malformed/absent -> deny or conservative (Class 4).
- Extend the shared cross-mode conformance pack with the guardrail tests above so an invariant proven
  once holds across in-process, sidecar, and overlay (Classes 1-8).
- CI runs `skills/starfish-verify` + secret-scan + the broadened dep-lint on every push.

## Suggested sequencing
1. Canonicalization helper + Class-1/6 guardrails (highest exploitability on Windows).
2. Sidecar input-validation layer (Classes 2, 4, 5) - body caps, schema allowlist, Host check, token perms.
3. Allowlist `net` + harden shell denylist with a bypass-corpus (Class 3).
4. Broaden dep-lint + declare deps + secret-scan in CI (Classes 5, 7).
5. Server-authoritative risk/target for approvals + audit (Class 8).
