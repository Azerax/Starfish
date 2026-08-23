# M3 — Dispatch: Verification Plan

> Companion to `docs/BRIDGE_LIVE_PLAN.md`, `USABILITYROADMAP.md`, `ROADMAP.md`.
> Status: **grounded against the live repo at v0.26.0**, not the planning docs alone — several of
> those docs are stale on this exact question.

## 0. The headline finding: M3 is not a build task, it's a verification task

`ROADMAP.md` calls M3 "Built; this is the next open gate" and frames the honest next question as
"behavioural, not architectural." I read the actual code to check whether that's still true as of
today, not as of `USABILITYROADMAP.md`'s July 13 snapshot (which still says "dispatch... is unwired, so
an order in the app executes nothing"). It is not true anymore — that note is stale. The dispatch seam
is fully wired, end to end:

`packages/desktop/app/src/renderer/src/screens/Home.tsx` (the "What do you need?" box) already calls
`bridge.requestAction({ intent: { kind: 'mission', text } })`. That hits `gov:requestAction` in
`main/index.ts`, which calls `runAgent(brief)`. `runAgent` builds a real runtime (`ModelRouter` +
`Dispatcher` + `HostRunner`), creates a governed `Task`, and instantiates a real `AgentLoop` wired to
the live `PDP`, `AuditLog`, and `DecisionBroker` (`resolveAsk` awaits an operator verdict from the
broker — the exact proposer≠approver seam `BRIDGE_LIVE_PLAN.md`'s design spine calls for). The loop
runs with the real `STARFISH_TOOL_SCHEMAS` and a boundary scoped to the project root.

That means M4's tool execution is effectively riding along too. `packages/desktop/src/peps.ts`'s
`makeExecutor` is not a stub: `fs.read`/`fs.list`/`fs.write` are boundary-checked and secret-path-
checked; `run_tests` and `git_commit` are routed through the hardened T-05 command templates (repo
hooks disabled, `--no-verify`, scrubbed git config); writes get a pre-image backup before every
overwrite. `BRIDGE_LIVE_PLAN.md`'s own status banner (2026-07-15) already says Phases 1–4 are "largely
BUILT... this plan is now a reference for remaining polish + the runtime behaviour check, not open
construction" — I'm confirming that's still accurate three weeks and several commits later, and it is.

Two smaller things the planning docs list as open gaps are also already closed: `gov:getAgentDetail` is
wired in `main` (the "exists in contract/renderer but not main" note is stale), and `DecisionBroker` is
constructed with real persistence (`new DecisionBroker(host.governor.audit, join(root, 'state',
'decisions.json'))`) — a restart re-offers pending decisions rather than losing them, per the
fail-closed design in `broker.ts`'s own comment ("decisions persist fail-closed — a restart re-offers
them; nothing is ever auto-approved").

One real, confirmed gap: **Phase 5 (live push) is not built.** There is no `gov:evt:*` emission
anywhere in `main/index.ts` — the Bridge still polls (the plan's "drop the 2.5s poll for push" is still
future work). This doesn't block M3's core question; a live dispatched run will still show up on the
next poll tick. It's a legitimate fast-follow, not a blocker.

## 1. What actually needs to happen: one real run

Every check above is static analysis and conformance-test coverage — the same category of evidence I
had for the Threat Immunity Fabric before actually running its tests, which is exactly where a real bug
(the seal self-invalidation) turned up that no amount of reading would have caught. The same risk
applies here, probably more so: this path involves a live network call to a real model, real tool
execution against a real filesystem, and real timing — categories of failure a conformance test with a
fake bridge/mocked runner cannot fully cover. So the plan is one concrete action, not a construction
list.

### Step 1 — Preconditions (a few minutes, on your machine)
- Confirm an Anthropic API key is set in Settings (goes to the OS keychain via `provider:setKey`;
  `gov:getReadiness`'s `provider-key` blocker will say so plainly if not).
- **You do not need to touch `STARFISH_ALLOW_EGRESS` for this.** I checked `provider.ts`: `ANTHROPIC`'s
  `kind` is `'anthropic'`, not `'router'` — the egress blocker only fires for router-kind providers
  (OpenRouter). The "confirm the egress default posture" open decision in `USABILITYROADMAP.md` §6 only
  matters once/if OpenRouter is the active provider; it's moot for the default Anthropic-direct path.
- Confirm the budget isn't paused (`gov:getReadiness`'s `budget-hard` blocker).

### Step 2 — The dogfood run
`BRIDGE_LIVE_PLAN.md` already specifies a good first target, small and self-referential: *"Worker: add
an optional `lastActiveTs` to `AgentDetailView`, update the conformance fake bridge, run the desktop
tests."* It deliberately exercises `fs.read`/`fs.write`, an ask-gated `git_commit`, and the Evidence
Gate (a "tests pass" claim can't be made without a recorded run backing it) in one small task. Use that
target unless it's already been done since the plan was written — if so, pick an equivalently small,
real, self-referential change to the repo.

Run it live: `npm run dev` → the desktop app launches → type the brief into Home's "What do you need?"
box → watch it dispatch. Expect at least one PDP `ask` to land in the Bridge's "Needs your go/no-go" —
approve it there and confirm the run resumes rather than stalling. Watch it to a `stopReason` (the UI
surfaces this — `completed`, `no-progress`, `budget-hard`, `claim-unbacked`, or `max-steps` — precisely
so a run's outcome is never just silently absent).

### Step 3 — Expect and fix at least one real bug
Don't be surprised if something breaks that no conformance test caught — that's the point of doing this
at all, not a sign something's wrong with the prior work. Categories worth watching for specifically:
timeout/retry behavior on the real Anthropic call, `maxSteps: 8` being too tight or too loose for a real
task, boundary edge cases with real absolute Windows paths, and whether the Evidence Gate's
claim-matching is strict enough to false-positive-reject a legitimate "tests pass" claim.

### Step 4 — Capture the proof artifact
This closes the exact gap the roadmap docs have been flagging since M0: a full governed session,
captured end to end (a screen recording or the `starfish audit --json` export of that run's chain), is
the thing that turns "constructed" into "proven." It also directly satisfies Definition-of-Done item
3(B) in `USABILITYROADMAP.md`.

### Step 5 — Update the docs to match reality
Once the run completes: mark M3 (and note the M4 overlap) verified in `ROADMAP.md` and
`USABILITYROADMAP.md`, replace `BRIDGE_LIVE_PLAN.md`'s "largely BUILT" framing with "verified," and log
Phase 5 (live push) as the one confirmed remaining gap rather than leaving five different docs each
making a slightly different claim about what's done.

## 2. What this plan deliberately does not include

No new architecture, no new IPC channels, no new core module. If Step 2 surfaces a real structural gap
(rather than a bug), that becomes its own scoped fix — but the default expectation, grounded in what the
code actually does today, is that this is real, working software waiting on its first live rehearsal.
