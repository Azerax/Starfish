# ADR 0003 — The completion receipt: separating "the tool said it worked" from "it worked"

Status: accepted
Date: 2026-10-11
Related: `GOVERNANCE.md` principle 6 ("no unbacked word"); ADR 0002; `docs/design/CONTROL_PLANE_PLAN.md` §3
Implements: `packages/governance-core/src/completion.ts`

## Context

Starfish can already refuse an agent's unbacked claim. `claims.ts` grades an agent's own utterances
against the ledger and blocks a completion claim the record does not support. That closes the gap
between *what the agent said* and *what the system observed*.

It does not close the gap between *what the system observed* and *what happened in the world*.

Today the strongest thing the ledger can say about a consequential action is **the tool returned
success**. Every layer above treats that as completion. Which means three materially different
situations are recorded identically, or near enough that no consumer can separate them:

1. The tool executed and the intended effect exists.
2. The tool returned success and the effect did not occur, or occurred partially.
3. The call was dispatched and no response ever came back.

The third is the sharpest, because the natural implementations are both wrong. Treating a lost
response as failure invites a retry that double-executes. Treating it as success records an effect
nobody observed. **"We do not know" is a distinct answer and the system had no way to write it down.**

The proposal that prompted this ADR asked for three modules — reliable MCP execution, end-to-end
observability, and a decision engine. They are not three problems. They are three consumers of one
record that did not exist.

## Decision

### 1. One append-only receipt correlating the whole chain

A `CompletionReceipt` carries the identities that let a reviewer walk from intent to observed outcome:
task, decision, approval, local invocation, the control plane's remote invocation and its external
audit id, the requested effect, a commitment to the inputs, the observed final state, the verification
method and verifier, evidence hashes, and the audit sequence number.

Correlation is the whole point. A control plane's activity log and Starfish's ledger each know half of
what happened; neither is authoritative for the other, and without shared ids a reviewer cannot join
them.

### 2. A status machine whose job is to keep distinguishable things distinct

```
not-executed        the call never left
started             dispatched, no response yet
returned-success    the tool said it worked          <- today's ceiling
returned-failure    the tool said it did not work
response-lost       dispatched, outcome UNKNOWN
verified            observed state confirms the intended effect
contradicted        observed state refutes it
unverifiable        no verification method exists for this effect
claimed-unverified  the agent asserted completion on insufficient evidence
```

Legal transitions are an explicit frozen table, the pattern `evidencetypes.ts` already uses, rather
than inferred from ordering.

Three choices in that enum are load-bearing:

**`returned-failure` is not in the plan's list and is added here**, because the plan's list could not
represent a state the codebase already produces. `controlplane.ts`'s `McpInvocation.outcome` is
`not-forwarded | forwarded-ok | forwarded-error | forwarded-lost` — four states, written months
earlier — and `forwarded-error` has no home in an eight-value enum that jumps from `returned-success`
to `response-lost`. Without it, a caller mapping an invocation into a receipt must mislabel a reported
failure as `not-executed` (false — it did execute) or `returned-success` (false).

The four map one-to-one, and `statusFromInvocationOutcome()` makes that mapping total rather than
leaving each call site to guess. A reported failure is also *verifiable*: a tool can report failure
after a partial write, so the effect may exist anyway — which is why `returned-failure` has outbound
verification edges rather than being terminal.

**`unverifiable` is first-class, not an error.** Some effects cannot be independently observed. If the
only options were verified and contradicted, every unverifiable effect would be recorded as one or the
other — and in practice as verified, because that is the path of least resistance. A system that
cannot say "I have no way to check this" will quietly claim it checked.

**`claimed-unverified` is reachable from every non-terminal state**, mirroring how `revoked` works in
the threat-evidence lifecycle. An agent can assert completion at any point; the record must always be
able to answer "that assertion is not supported" without first advancing the dispatch state.

### 3. `returned-success` is structurally not completion

`isProvenComplete()` returns true for **`verified` only**. Not for `returned-success`.

This is the entire ADR in one function. A consequential task cannot be completed on a tool's
self-report, and the check is a predicate rather than a convention, so a caller cannot forget it. The
companion `canCompleteTask(status, { consequential })` makes the asymmetry explicit: non-consequential
work may complete on `returned-success`, consequential work may not.

### 4. The seal covers what was fixed at dispatch, and nothing that is observed later

Same reasoning as the threat-evidence envelope, and the same trap avoided. Sealed: the receipt,
task, decision, approval and invocation ids, the requested effect, the input commitment, the dispatch
timestamp. **Not sealed:** status, tool response, observed final state, verification result, evidence
hashes, discrepancy.

Sealing an observation would make every verification look like tampering on the very next transition.
And more seriously, it would mean a method that records an observation — which takes no approver —
became a mutation path for a sealed object, routing around proposer-is-not-approver exactly as
`scope.ts` warns.

### 5. Shipping without a verifier, and saying so

This increment implements the record and the machine. It implements **no verifier**. The statuses
beyond `returned-success` are reachable, tested, and produced by nothing in production.

That is deliberate and it is the honest order: the record has to exist before anything can populate
it, and three modules need to agree on it before any of them is built. But it creates a specific
overclaim risk, so it is written down here: **until a `Verifier` exists, this module must not be
described as outcome verification.** It is the place outcome verification will be recorded.

## Consequences

**Good.** One correlation scheme instead of three. "We do not know" becomes writable. A consequential
task cannot complete on a self-report, enforced by a predicate. Reliability work, observability and the
decision layer all key on the same ids, so an improvement in one is legible to the others.

**Costs, stated plainly.** The receipt is another append-only record on the audit chain, so it adds
write volume to a ledger that already fsyncs per event. Consequential work now needs a verifier to
complete at all, which means `unverifiable` effects will surface as friction — correctly, but it is
friction that did not exist before. And a status enum with nine values is harder to consume than a
boolean; that is the price of not conflating things.

**Explicitly not implemented.** No verifier (§5). No retry or idempotency logic — that is the Sentinel
increment, and it depends on this record to be safe. No OpenTelemetry spans; they will read these ids
rather than invent their own. No persistence beyond the audit entries themselves.

## Alternatives rejected

**A boolean `completed` plus a reason string.** What exists today in effect. It cannot distinguish lost
from failed, and a free-text reason is not a thing a consumer can branch on. Every downstream module
would re-parse prose.

**Let the tool's response be the completion signal.** The status quo, and the thing this ADR is for. It
makes the executing tool the authority on whether it executed, which is precisely the claim a
governance system should not accept — the same reason an agent's own word is not spendable.

**Verify everything, and treat unverifiable as a failure.** Appealing, and wrong. It would block
legitimate work whose effects genuinely cannot be observed, and the pressure would immediately be to
write loose verifiers that return `verified` by default — worse than admitting the gap.

**Put the receipt in the threat-evidence lifecycle.** They share a shape (sealed envelope, transition
table, quorum-ish progression) and share no subject. Threat evidence is about a detection earning
authority; this is about an action earning the word "done". Merging them would couple two lifecycles
whose stages happen to rhyme.
