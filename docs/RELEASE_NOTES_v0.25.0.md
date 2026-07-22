# Project Starfish v0.25.0 — release notes

> **STATUS: DRAFT — not shippable yet.** This documents the hardening that has landed and been
> regression-tested. It must NOT be tagged or published until the remaining in-flight hardening items
> are closed (see "Still in progress" below) — a release that leads with "hardening" while a known
> enforcement gap is still open would overclaim, which is exactly the failure this release is about.
> The specific open items are tracked privately (unpatched findings in a security product are not
> published); this note describes only what is *fixed*.

**Date:** 2026-07-20 (draft) · **Theme:** we turned the audit on ourselves. A systematic adversarial
self-audit of Starfish's own governance core — comparing every stated guarantee against the code that
should enforce it — surfaced a batch of real gaps. This release closes nineteen of them, each with a
regression test that plants the actual attack.

The honest framing up front: **finding these is the system working, not failing.** A governance product
that cannot show you where its own edges were is not one to trust with a boundary. Every fix below ships
with a test that would have caught the gap, and the suite grew from 602 to 632 passing as a result.

---

## The method

Four adversarial sweeps over `packages/*/src`, each with a single question:

1. **Fail-open defaults** — where does a default, fallback, error path, or unmatched condition *permit*
   rather than *deny*, in a deny-by-default system?
2. **Claimed but not enforced** — which guarantees are stated in a comment or doc but have no enforcing
   code, or a second code path around the check?
3. **Gameable defensive logic** — which scoring, normalization, or denylist can be defeated at the edges
   with specific inputs?
4. **The second privileged path** — where is the desktop/IPC surface less governed than the agent path?

Findings were verified by reading the code directly, not accepted on assertion, and each fix landed with
an adversarial regression test in the same loop — never "fix now, prove later."

---

## What this release hardens

### Egress can no longer be tricked over IPv6 (SSRF)
The internal-destination guard (`netguard`) was IPv4-only: it blocked `127.0.0.1` and RFC-1918 ranges
but let their **IPv6 equivalents** through — loopback in its hex form, link-local (`fe80::/10`),
unique-local (`fc00::/7`), and cloud-metadata reached over IPv6. `http://[::ffff:127.0.0.1]/` normalizes
to a hex form the old check never matched. The guard is now IPv6-aware across every form, and an
unresolvable or malformed host **fails closed** (blocked) instead of open.

### The spend cap can no longer be walked backward
The token/budget meter accumulated whatever usage a provider reported — including **negative** numbers.
A compromised or redirected model endpoint could report negative usage to *subtract* from the meter and
slip back under its hard limit, defeating the pause-at-limit control entirely. Usage is now clamped to a
finite, non-negative delta; the meter only ever moves up.

### `.env` poisoning covers proxy and TLS-trust primitives
The `.env`-content screen already blocked `NODE_OPTIONS`, loader preloads, and provider-endpoint
redirects. It now also blocks `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` (which route *all* egress through an
attacker), `NODE_EXTRA_CA_CERTS` (an attacker CA — silent TLS MITM), and `NODE_TLS_REJECT_UNAUTHORIZED`
(disables verification). And the audit log now redacts secret material placed anywhere in an event's
`detail` payload, not only in `reason`/`target`.

### Governance state is denied to agents by construction
Deriving an agent or skill boundary with a `forbid` list only *dropped whole roots* that fell inside a
forbidden path — but governance, audit, and state sit *under* an allowed root, so they survived and stayed
readable. The `forbid` list is now carried through as an explicit `deny` subtree, so
`.starfish/governance`, `audit.jsonl`, and `state/` are unreadable by construction. The desktop delete
path's custodian boundary was brought into the same posture, so neither the agent path nor the cleanup
path can reach the tamper-evident log.

### A shell command reading a secret can no longer silently auto-run
The raw `shell` tool declares no path parameters, so the boundary and secret-path checks that guard
`fs.read`/`fs.write` never inspected it — `cat ~/.ssh/id_rsa` reached the risk scorer unscreened and, at
Medium risk tolerance, auto-allowed with no human. A shell command that **reads or copies a secret path**
now escalates to a human decision, **tolerance-independent** — it can never be a silent auto-allow. The
screen is conservative (a read/copy verb applied to a secret-path token), so ordinary shell — build
commands, `git commit` messages that merely mention `.env`, reading normal source files — is untouched.
(General path containment for arbitrary shell arguments remains broad by design; routing exec through the
hardened command templates is the architectural direction, tracked separately.)

### Risk and policy decisions are correct at the edges
Three correctness gaps in the decision path: an operator's explicit `ask` rule on a low-risk tool was
silently discarded (now honoured); a governance `meta` tool that declared a path skipped the boundary and
secret checks entirely (now checked); and a tool with an **unrecognised category** and no explicit risk
tier collapsed to auto-allow — the least-understood case landing on the most permissive outcome (now
fails safe to *critical*, requiring a human).

### Memory-wiki guarantees are now fully enforced
Phase 1 of the Linked Evidence Wiki shipped in v0.24.0 with strong controls, but the self-audit found the
guard plumbing was incomplete:
- The decision registry could be written with **no gate and self-declared provenance** — a caller could
  forge a canonical "why X?" decision citing evidence that did not exist. It is now sole-writer guarded,
  and every cited evidence id is verified to exist.
- Entity **merge/split reversal** bypassed the gate — a single low-privilege identity could un-merge or
  retire pages the dual-control gate exists to protect. Reversal is now dual-controlled like the forward
  operation.
- The **untrusted-memory envelope** could be escaped: a page whose body contained a literal end-of-fence
  marker closed the envelope early, placing attacker text outside the "treat as data, inert" boundary.
  Embedded markers are now neutralized before wrapping.
- Quarantined (screened-positive) content is now withheld even from the raw substrate accessors, and two
  remaining write methods were brought under the sole-writer guard. The "no ungoverned read path" wording
  was also corrected to be precise about substrate-vs-agent-path rather than overstated.

### Resilience: corrupt state is loud, not silently empty
Persisted runtime state (tasks, capabilities, services) restored through a helper that returned the same
empty result for "file absent" and "file corrupt." Truncating a state file silently erased every
quarantine/rejection disposition with no signal — a censorship primitive. Corrupt or wrong-shape state now
drops the system into **safe mode** with a critical audit entry; absent state is still a normal fresh boot.

### Smaller correctness fixes
The evidence gate now matches recorded artifacts **exactly** (a claim about `config.ts` is no longer
"backed" by a write to `myconfig.ts`); a signed source-revocation is stored in the same normalized form
all lookups use, so a "remote kill" that reported success actually blocks the source.

---

## How to verify
`npm run ci` (typecheck + unit + conformance + determinism + dependency-direction lint + secret/IP scans +
SBOM). This batch: **99 test files, 632 passed, 3 skipped** — including the new self-audit regression
tests (`selfaudit-fixes.conformance.test.ts` plus additions to the netguard, sources, memory, wiki,
boundary, pdp-risk, and boot-persistence suites). Every fix above has a test that plants the actual
attack it refuses.

---

## Still in progress (not in this release, and why the version is a draft)

Hardening is continuous. Some findings from the same self-audit require larger, higher-risk changes and
are being done with care rather than on momentum — a fix that breaks the golden path (an ordinary
governed session, the zero-change demo, first governed creation) is not a fix. These are tracked
privately until they land, and this release is not tagged until the highest-severity ones are closed.

Also still tracked, and stated rather than hidden:
- **H1 — OS-level isolation (T-25)** remains the single biggest residual. Untrusted tasks run to the
  enforcement seam, not a container/microVM/namespace boundary. `SECURITY.md` states this.
- **The optional enforcement gates** (verify-before-invoke, task-binding, scope non-deviation) are built
  and tested but not yet wired on by default in the shipped composition roots; making that posture
  explicit and safe-to-enable is in progress.
- Signed auto-update + blocklist enforcement (H2), eval-mode/production-target guard (H3), and the OpenSSF
  Scorecard remediation (currently 3.7/10) remain tracked in `HARDENING_BACKLOG.md` and `ROADMAP.md`.

## Deferred to the owner (release mechanics)
Do not tag or publish until the in-flight items above are closed and the golden-path gate is green. Then:
`git commit` + push (PR against `master`, required `verify` CI check); update `CHANGELOG.md`; tag
`v0.25.0`; `npm publish` with provenance/SBOM; independent external security review; rotate the live
`.env` key.
