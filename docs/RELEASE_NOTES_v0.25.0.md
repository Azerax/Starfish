# Project Starfish v0.25.0 — release notes

**Date:** 2026-08-01 · **Theme:** we turned the audit on ourselves. A systematic adversarial
self-audit of Starfish's own governance core — comparing every stated guarantee against the code that
should enforce it — surfaced a batch of real gaps. This release closes twenty-six of them, each with a
regression test that plants the actual attack, plus the desktop IPC-authority hardening that followed
from the same audit.

The honest framing up front: **finding these is the system working, not failing.** A governance product
that cannot show you where its own edges were is not one to trust with a boundary. Every fix below ships
with a test that would have caught the gap, and the suite grew from 602 to 656 passing as a result.

---

## Scope — what this hardens, and the boundary it hardens toward

This release also makes the **threat model explicit** ([`docs/THREAT_MODEL.md`](THREAT_MODEL.md)):
Starfish provides reasonable, advanced governance — it defends against a misbehaving/hijacked **agent**
and **injected content**, and it **trusts the operator and their machine**. Disabling your own governance,
or a host already running native attacker code (including a browser 0-day in the desktop UI), is out of
scope by design — not a failure to fix. Every finding below is an *in-scope* gap; the desktop
renderer-authority work raises the bar and shrinks blast radius within that boundary, and states its
residual honestly rather than pretending to defeat an attacker who already owns the process.

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

### Per-agent capability allowlists are now enforced
An agent's own `allowedTools` list was declared, shown in the UI as "deny-by-default otherwise", and
**never checked** — only the inverse (does the *tool* allow this agent). So a read-only agent could call
any `*`-granted tool, and "this agent reads memory only" was cosmetic. The agent's allowlist is now
enforced deny-by-default; an agent that declares no list stays unrestricted (backward-compatible), and
the seed's own agents were reconciled so their lists cover what they legitimately call.

### Policy adjudicates the declared path, not a decoy
The policy resource was resolved as the *first string-valued input in JSON order*, not the tool's
declared path parameter — so a call could carry a benign decoy first (`{note:'/ok', path:'/etc/passwd'}`)
and be judged against a rule scoped to the decoy. It now resolves from the declared path parameter.

### Integrity fails closed on a stripped manifest
A registered capability whose per-file hash manifest was removed (a tamper to *disable* tamper-detection
by deleting data rather than forging it) passed integrity unconditionally. It now fails closed and
auto-quarantines — intake always writes a manifest, so its absence is an anomaly, not a valid state.

### Enforcement posture is explicit and audited
The optional enforcement gates (verify-before-invoke, task-binding, scope non-deviation) could be off
**silently** — an operator could believe a control was enforced when it was dead code. Boot now records
the actual posture, emits it on the audit chain, and exposes it on the governor. Verify-before-invoke is
now on by default in the shipped roots (it only fires on calls that claim a capability). Scope
non-deviation is honestly reported **off** — nothing issues a scope contract at runtime yet, so it is
displayed off rather than pretended on; a contract issuer is the tracked path to enabling it.

### The desktop app can no longer trust the renderer to say who's asking
Electron IPC has no caller authentication, and the desktop app was trusting renderer-supplied authority
outright: `req.actor` on approvals, and a `confirmed`/`confirm` boolean on tolerance changes and
permanent deletes. Any code running in the renderer — including injected code — could self-approve a
governed decision, raise risk tolerance to widen auto-run, or purge the trash. Closed in two passes:

- **`IpcAuthority` + renderer integrity.** The operator principal is now assigned by the main process,
  never read from the IPC payload. Privileged operations require a per-session capability token that
  reaches the renderer only through the preload closure — a foreign frame or webview can't present it.
  The shipped renderer bundle is hashed on load, on every filesystem change, and on a periodic sweep; a
  modified, injected, or removed asset latches tamper and drops the system into safe mode. `sandbox:true`
  and a strict CSP (no inline/remote scripts) close the injection vector those checks depend on.
- **A trusted-path confirmation for irreversible operations.** The first pass left one residual stated
  openly: a Chromium RCE in the renderer runs beneath the JS layer entirely, where the token, CSP, and
  integrity check all live — it could still forge a privileged call. The one thing an RCE cannot forge is
  a main-process modal, so permanent purge and destructive `approved` deletes now require
  `dialog.showMessageBoxSync` in main before they proceed. An RCE'd renderer with a valid token and a
  pristine on-disk bundle still cannot click that dialog for the human.

The authorize-then-act logic was also extracted into dependency-injected functions and unit-tested
directly (21 desktop IPC-authority tests) rather than only asserted through integration coverage — proving
properties like "no token → the underlying action is never called" and "tampered renderer → every
privileged op refused even with a valid token."

### Smaller correctness fixes
The evidence gate now matches recorded artifacts **exactly** (a claim about `config.ts` is no longer
"backed" by a write to `myconfig.ts`); a signed source-revocation is stored in the same normalized form
all lookups use, so a "remote kill" that reported success actually blocks the source; the
catastrophic-shell denylist gained the interpreter, disk-device, and cwd-wipe bypasses it was missing;
and an absent HTTP Host header on the sidecar now fails closed.

---

## How to verify
`npm run ci` (typecheck + unit + conformance + determinism + dependency-direction lint + secret/IP scans +
SBOM). The self-audit findings alone: **99 test files, 656 passed, 3 skipped** — including the new
self-audit regression tests (`selfaudit-fixes.conformance.test.ts` plus additions to the netguard,
sources, memory, wiki, boundary, pdp-risk, and boot-persistence suites). With the desktop IPC-authority
work folded in: **101 test files, 677 passed, 3 skipped** (21 desktop IPC-authority tests across
`ipc-authority.conformance` and `privilegedipc.conformance`). Every fix in this release has a test that
plants the actual attack it refuses. Reconfirmed clean with a full native `npm run ci` pass immediately
before this release was finalized.

---

## Known residuals (tracked, not blocking this release)

Per `docs/THREAT_MODEL.md`'s trust ladder, an accepted residual within a stated boundary is not the same
as an open in-scope gap — these are the former, and hardening against them continues independently of
this release:
- **H1 — OS-level isolation (T-25)** remains the single biggest residual. Untrusted tasks run to the
  enforcement seam, not a container/microVM/namespace boundary. `SECURITY.md` states this; a Chromium RCE
  defeating the trusted-path dialog itself (fakes the click via the compositor) sits in the same
  OS-sandbox territory.
- Signed auto-update + blocklist enforcement (H2), eval-mode/production-target guard (H3), and the OpenSSF
  Scorecard remediation (currently 3.7/10) remain tracked in `HARDENING_BACKLOG.md` and `ROADMAP.md`.

The optional enforcement gates (verify-before-invoke, task-binding, scope non-deviation) are no longer on
this list — verify-before-invoke is on by default in the shipped roots as of this release (see
"Enforcement posture is explicit and audited" above); scope non-deviation is honestly reported off, since
nothing issues a scope contract at runtime yet.

## Release mechanics (owner-tracked, separate from the hardening work itself)
Independent external security review and rotating the live `.env` key are standing items on Scott's own
list, not automatable from here — this release does not wait on either to be tagged, but they stay
tracked. Git tag, push, and `npm publish` are plain commands at this point; see the session's reply for
the exact sequence.
