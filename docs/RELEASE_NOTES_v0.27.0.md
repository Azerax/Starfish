# Release notes — v0.27.0 (2026-08-20)

**The adversarial-review release.** Twelve questions posed publicly by **u/WillowEmberly** asked, of
each control, not *"does it exist"* but *"what happens when it is absent, disabled, failed, or
lying."* Ten findings came out of it. Four were defects. **All ten are fixed here.**

Every previous audit — MOSAIC, the arXiv sweep, the persona threat model — asked whether a control
existed for a given attack. These questions asked what the control does at its edges, and that turned
out to be a different question with different answers.

---

## The lesson worth more than any single fix

Three of the ten findings (F-7, F-8, F-10) are the same failure mode: **a correct, fully-tested module
that nothing calls.**

- `scope.ts` — D1–D4 non-deviation, seal verification, budget metering. 7 green tests. Zero
  production callers.
- `monitor.sweep()` — every runtime rule we have. Invoked only by its own conformance suite.
- `Registry.verifyIntegrity()` — the out-of-band-edit check. One caller, in a test.

All three passed CI continuously while being inert in the shipped product. Our conformance tests
instantiate subsystems directly, which proves a module **works** — it cannot prove a module **runs**.

`packages/governance-core/src/reachability.conformance.test.ts` now asserts against source that each
enforcement control is referenced from a non-test file. That single check would have caught three of
these ten findings, and it is the most valuable thing in this release.

> **Green tests are not evidence of an enforced control.**

---

## Fixed

### Telemetry that vanishes (F-1, F-2)

The sharpest question was *"what happens when telemetry disappears rather than reports failure?"*

`AuditLog` recovery was gated on the log existing, so deleting `audit.jsonl` outright skipped recovery
entirely — and the head anchor, the one artifact proving events had existed, was never read. Integrity
reported `clean`, `verify()` returned `true`, `seq` restarted at 0. The monitor then agreed: all-zero
counters, no findings, and `reconcile({allClear:true})` *passed*.

Deleting the audit was a single move that defeated the watcher **and** its invigilator.

Now: recovery always runs, an anchor with no log reports `audit-deleted`, the governor boots into safe
mode, and a log that existed and is now gone is a `critical` `audit-vanished` finding that
`reconcile()` refuses to corroborate.

Partial damage was always handled well — torn tails, mid-file corruption and truncation-with-log-present
all entered safe mode. It was total absence that read as a fresh install. Notably `boot.ts` already got
this exact reasoning right for state files, using an `UNREADABLE` sentinel to separate absent from
corrupt; we simply never applied it to the audit log itself.

### An ask that could be silently overruled (F-3, F-4)

`writeProfile:'auto'` relaxed a PDP `ask` into an `allow` keyed only on `d.ask && tool==='fs.write'`.
But a routine medium-risk write and an operator's own explicit `ask` policy were both an
indistinguishable `{allow:false, ask:true}` — so a rule the operator had written by name was silently
voided by a friction setting elsewhere in the config.

`Decision` now carries `askOrigin: 'risk' | 'policy' | 'floor'`. Only `'risk'` is relaxable.

The relaxation was justified by recoverability, and that was not verified either: `snapshotBackup`
returned a bare boolean where `false` meant *both* "no existing file" and "the backup threw", rendered
in the audit as `'new file'`. An unrecoverable overwrite was logged as a safe creation. It is now a
tri-state, and `'failed'` escalates to the operator instead of auto-allowing.

### Floors that only covered one surface (F-11)

Found during the site-claims sweep rather than the original review. `isCatastrophicShell` and
`isBlockedHost` lived only in `@starfish/governance-hooks`, so they protected the Claude Code overlay
and nothing else — an SDK or `starfish serve` consumer got no catastrophic-shell denylist and no
egress host guard at all, while our own docs described both as floors "enforced independently of any
policy or tolerance."

Moved to `governance-core/src/shellguard.ts` and enforced inside `PDP.ingress`, ahead of policy and
tolerance, on every transport.

**Behaviour change:** `rm -rf /` is now denied outright rather than escalated for approval. It was
previously classified `critical` and offered to a human; the overlay already refused it. Critical but
legitimate destructive work (`rm -rf ./build`) still escalates exactly as before.

### Adjudicating the wrong resource (F-5, F-6)

`ccToGoverned` discarded the Glob/Grep pattern and substituted `'.'`, so `Glob{pattern:'/etc/**'}` was
adjudicated as a read of the cwd and **allowed** — the PDP ruled on one path while the tool read
another. It also dropped `content` on writes, which made the poisoned-`.env` screening unreachable
from the overlay. Both now carried through.

### Rings that disagreed on audit failure (Q8)

Ring 1 (the PDP) failed closed when the audit could not be written. Ring 3 (the PEP) swallowed the
same failure and continued — so an unwritable audit denied every future *decision* while still
executing already-authorized *work*, with no record of it. `peps.ts` now audits before acting on every
mutating operation and aborts if the record cannot be written.

### Dormant controls, and one open door (F-7, F-8, F-9)

`monitor.sweep()` and `Registry.verifyIntegrity()` now run on the sidecar's live tick, so an
out-of-band edit to `tools.json` trips safe mode within a second instead of never. New
`GET /v1/integrity`; `GET /v1/monitor` performs a real sweep and returns findings.

`startSidecar` passed `operators: undefined`, which makes `broker.resolve` skip the operator check —
proposer≠approver still held, but any other authenticated identity could approve someone else's
decision. It now defaults to `['operator']`.

### Claims brought back in line with the code

A matching sweep of `site/` (`docs/SITE_CLAIMS_AUDIT.md`) checked every marketing claim against
shipped code. The Arena (design-only, no implementation) and non-deviation enforcement (F-10, unwired)
were asserted in the present tense on `starfish-vs-hermes`, two of them inside `FAQPage` JSON-LD that
Google can surface as rich results, on a page naming a competitor. Both are now roadmap-labelled.

Two claims were one word from being true rather than needing a caveat, so we changed the code instead:
the **Evidence Gate is now ON by default** in the SDK, and the catastrophic-shell/egress floors are
now genuinely universal (F-11). Task-binding, self-integrity and keychain-fallback claims were
qualified to match shipped defaults.

`index.html` came through well. "Governance contains blast radius — it is not a force field", "Not
OS-level isolation", "for genuinely hostile code, keep it inside a container or VM" — the most
important claims on the site, and they already pre-empted the worst finding below.

---

### F-10 — non-deviation, finally enforced

The last finding, closed in a follow-on pass the same day.

`scope.ts` shipped inert for a real reason, not laziness: `ScopeContractLedger.check()` fails closed
when a task has no contract, and **nothing issued contracts**. Enabling the gate would have denied
every call in the system. The missing piece was an issuer, not a flag.

`governance-core/src/scopeissuer.ts` supplies it, with an applicability policy that is a scope
statement rather than a fudge:

| Mode | Behaviour |
|---|---|
| `contracted` *(default)* | A call carrying a `taskId` **must** have a contract or it is denied. A call with no `taskId` has no mission to deviate from, and falls through to the agent's standing grants, boundary and floors. |
| `strict` | Additionally requires a `taskId` on every call. |
| `off` | Exact pre-v0.27 behaviour. |

The middle row matters: *"no task, no tool"* is a **different** control (`enforceTaskBinding`) that
already exists and composes with this one. Conflating them would have made non-deviation impossible
to enable without also mandating task binding everywhere.

Contracts auto-derive from what governance already knows, so nobody hand-authors one — D1 from the
agent's declared tools, D2 from the boundary roots, D4 from `scopeCallBudget`. **D3 is the one place
derivation tightens:** an auto-derived contract permits *no* commands until the task names them.

Two details that decide whether this is real:

- **`posture.scopeNonDeviation` is now derived from the live gate**, not written as a literal. The
  hardcoded `false` was F-10 in miniature — it read as an honest disclosure while being
  unfalsifiable. The reachability test asserts the literal is gone.
- **Contracts persist and restore.** Without that, an in-flight task returns from a restart
  contract-less and has every call denied — the gate would look broken rather than fail-safe.

### The CI blind spot was wider than the governance layer

Wiring the release script surfaced that `tsconfig.json`, `vitest.config.ts`, `dep-direction-lint` and
`ip-denylist-scan` **all** scope to `packages/`. The Azure/Foundry tree sits outside it, so 22 files
of Marketplace-facing TypeScript were checked by nothing, and five `azure/**/*.smoketest.mjs` had
never been executed by anything.

Same shape as F-7/F-8/F-10 — real code that no gate touches — applied to the commercial surface
instead of a governance control. Now covered by `typecheck:azure`, `smoke:azure` and an IP scan
extended to `azure/`, all wired into `npm run ci`. Everything passed first run: the code was fine, it
was simply unguarded, which is exactly why nobody noticed.

### Q12 — the demonstrated chain is now gated

The review didn't just ask questions; it produced a working two-hop chain, and that deserved a fix
rather than a footnote.

The chain worked because **neither hop subverts anything**. Writing `evil.test.js` is a legitimate
write. Running `run_tests` is the tool doing exactly its job — `node --test` executes what it
discovers. The T-05 template hardening was never bypassed: it stops `package.json` being the entry
point, and it still does. Only the *sequence* is an attack, and per-call risk scoring cannot see a
sequence.

`execprovenance.ts` adds **self-authored execution**: within one task, if the agent wrote a file the
exec tool it is now asking to run would execute, that call requires a human — and risk tolerance
cannot satisfy it. Same floor pattern as the existing secret-read check.

Deliberately an escalation, not a denial. Writing a test and then running it is ordinary developer
work; what is removed is the ability to complete that loop with nobody watching. One approval, once.

It is also targeted rather than blanket, and the tests prove each edge: an ordinary source write
doesn't gate the runner, a test write doesn't gate `git_commit`, another task's write doesn't taint
this one, and a *denied* write never taints at all.

### The other four questions that had no finding attached

- **Q5** — `TrashStore.purge`/`purgeAll` destroy the recovery store that makes soft-delete safe, and
  took no PDP and no audit. `purge` now requires an audit sink and records *before* destroying;
  `purgeAll` demands a literal `'PURGE-ALL'`.
- **Q4** — an agent declaring no `allowedTools` is unrestricted. Kept for compatibility, but now
  audited once per agent, with `strictAgentAllowlist` to make absence a denial.
- **Q9** — two more swallow sites: an unwritable anchor silently ended truncation detection; a broker
  that couldn't persist made pending decisions vanish on restart. Both now recorded.
- **Q2** — `resourceOf`'s "first string in JSON order" fallback survived F6 for tools declaring no
  path params. Conventionally-named fields now win over key order.

## Known gaps, stated plainly

**T-25 / H1 — no OS-level isolation.** Unchanged, and now the only headline residual.

Self-authored execution closes the *specific* chain the review found, but it is a control on a
sequence, not a boundary. Once code executes as the user, every in-process control is moot. No amount
of further in-process work moves that line — which is why it stays the headline rather than being
quietly absorbed into a list of fixes.

**The heuristic layer is still probability-reducing** (Q10). The risk regexes,
`isCatastrophicShell`, `scanEgress` and the new runner predicates are denylists; an adversary who has
read them can phrase around them. The controls that survive a reader are the authority-reducing ones:
boundary containment, default-deny, memory-cannot-authorise, the deletion hard rules, the exec
templates, and now scope contracts.

The shortest verified chain from model output to irreversible host effect is **two hops at Medium risk
tolerance, with no human**: write `evil.test.js` (medium, score 40, auto-allowed), then `run_tests`
(high, score 60, auto-allowed), and `node --test` executes it. The T-05 template hardening does not
help — it stops `package.json` being the entry point, which it does correctly, but the payload here is
an ordinary project file and running project test files is the tool's purpose. At Low tolerance (the
default) both hops ask.

That chain is gated entirely by one operator setting, with no independent control behind it, and it
ends in code execution as the user — after which every in-process control is moot.

> **Starfish governs a cooperative process. It does not contain a hostile one.**

---

## Verification

`108 test files, 743 passed, 1 skipped` (from 105/714 at v0.26.0). 29 new tests across
`adversarial.conformance.test.ts`, `reachability.conformance.test.ts` and
`writeprofile.hardening.conformance.test.ts` — each reproduces the *original* defect, so a regression
fails loudly rather than quietly.

Also green: dependency-direction lint, IP denylist scan, SBOM + license check.

Run on a scratch Linux install; this repo's `node_modules` carries Windows-only native bindings.
**Run `npm run ci` on Windows before tagging** — typecheck and the git-based secret scan are not
exercised by the Linux run.

## Upgrading

Three behaviour changes worth knowing about:

1. **A catastrophic shell command is refused, not escalated.** If you relied on approving one, you
   cannot. Critical-but-legitimate destructive work still escalates as before.
2. **The Evidence Gate is on by default** in `@starfish/sdk`. A run that closes with an unbacked claim
   now ends as `claim-unbacked` after a correction retry. Opt out with
   `createGovernance({ enforceClaims: false })`.
3. **Scope non-deviation is enforced**, mode `contracted`. A call carrying a `taskId` must have a
   scope contract or it is denied. `createGovernance()` / `runGovernedSkill()` issue contracts
   automatically, so the shipped path needs no change — but a host that calls `governCall()` with its
   own `taskId` must either call `governor.scope.issue({...})` or pass `scopeMode: 'off'` to
   `loadGovernor` while it wires issuance. Calls with no `taskId` are unaffected.

`startSidecar` now defaults approval authority to `['operator']`. If your deployment approved
decisions from another identity, pass it explicitly via the new `operators` option.

---

*Thanks to u/WillowEmberly, whose questions produced F-1 and F-10 and prompted everything else here.*
