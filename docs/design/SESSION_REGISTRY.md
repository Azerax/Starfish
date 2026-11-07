# Session registry: which agent sessions need you

**Status:** built on branch `feat/session-registry` (2026-11-07). This is the data groundwork that the calm
v2 and v3 screens in [UI_V2_V3_HERDR_STUDY.md](UI_V2_V3_HERDR_STUDY.md) need. Nothing in the UI uses it yet.

## What it adds

Before this change Starfish judged each Claude Code tool call, but nothing could answer "which sessions are
running, and is any of them waiting on me?" The hooks daemon kept a private per-session map and exposed none
of it, and an `ask` went only to Claude Code's own prompt.

Now the overlay daemon records every hook event in a **session registry** and writes a snapshot to
`.starfish/state/sessions.json`. Anything can read that snapshot and show the sessions in order of attention:

```
starfish sessions [--root <project>] [--json] [--watch] [--all]
```

```
  needs you
  ◆ worker  billing-api (fix/retry)               4:10  Edit: src/retry.ts  [medium]
    Answer in that Claude Code window; Starfish records what happens.

  everyone else
  ◐ worker  starfish (main)                       working · Bash
  ✓ worker  docs-site (main)                      finished 3m ago
```

## How it works

1. `starfish install --claude-code` now also registers `SessionStart`, `UserPromptSubmit`, `Stop` and
   `SessionEnd`. They are observation only and never block. The managed install registers them too.
2. The hook shim forwards a few descriptive fields with each event: `tool_use_id`, `cwd`,
   `permission_mode`, `model`, `source`. It does **not** forward the prompt text or the transcript path.
3. The daemon sends the decision back first, then records the event. Recording can't change a decision,
   and if it fails the failure is swallowed. A test checks that the decision is identical with and
   without tracking.
4. When the PDP answers `ask`, the daemon also files the ask in a broker on the new **`claude-code`
   channel**, tagged with the session. That broker lives in memory, because `state/decisions.json`
   belongs to `starfish serve` and two processes writing one file would overwrite each other.
5. Readers in other processes use the snapshot:
   - The `starfish sessions` CLI command.
   - `Governance.sessions()` in the SDK.
   - `GET /v1/sessions` and a `sessions` event on `/v1/stream` in the sidecar. The stream sends the
     event only when the list changes.
   - `httpBridge().sessions()` in `@starfish/ui`.

   An operator token sees every session. Any other token sees only sessions run as its own actor,
   the same rule as for pending decisions.

## Session states

The registry derives a session's state from the events it has seen; the state is never set directly.
So a missed event leaves a less specific state rather than a wrong one.

| State | Meaning | Glyph |
|---|---|---|
| blocked | An ask is open | ◆ |
| done | The last turn ended (`Stop`) and nobody has looked since | ✓ |
| working | A turn is in flight and something happened in the last 10 minutes | ◐ |
| idle | Nothing is in flight, or nothing was heard for 10 minutes | ○ |
| ended | The session ended (`SessionEnd`); hidden unless `--all` | · |

The order follows herdr: blocked, then done, working and idle. Among blocked sessions, the one that has
waited longest comes first. Within every other state, the most recently active comes first.

Housekeeping limits:
- Sessions quiet for 24 hours are dropped, even if an ask is still open. A Claude Code window closed
  mid-prompt sends no `SessionEnd`.
- The registry holds at most 500 sessions.

## How an ask is closed

Starfish does not answer these asks; Claude Code's own prompt does. Starfish records what happens next:

| Seen next | Outcome | Audit |
|---|---|---|
| A `PostToolUse` with the same `tool_use_id` | `ran`: the person approved | `decision:settled`, allow |
| `Stop`, a new prompt, or `SessionEnd` | `not-run`: refused, or the turn ended | `decision:settled`, deny |
| Another `PreToolUse` with no result for the asked call | `superseded`: refused, or the tool failed | `decision:settled`, deny |

Two guards keep the mirrored asks honest:
- `broker.resolve()` refuses a `claude-code` channel decision. An "approve" there would be audited as an
  operator approval that changed nothing.
- `broker.settle()` refuses every other channel, so observation can never stand in for an operator.

## Audit attribution

`ToolCall.sessionId` and `AuditEvent.sessionId` are new optional fields. The PDP's decision line, the hook
session's own lines and the broker's filed/settled lines carry the session id. A line with no session is
byte-identical to before, so old chains verify unchanged. The sidecar's stream now includes `sessionId` in
its audit projection.

## A bug found and fixed on the way

When Starfish answered `ask` and the person approved in Claude Code, the tool ran. Its `PostToolUse`
then arrived with no *allowed* `PreToolUse` before it, so `HookSession` audited it as an `orphan-post`
"no-silent-execution violation", and the monitor counted it. **Every approved ask was logged as a false
security finding.** The hook session now remembers the exact `tool_use_id`s it asked about, and accepts
one `PostToolUse` per id. A post with an unknown id, a reused id, or no id is still flagged as before.

## Not done yet

- **Approving from Starfish.** The calm screens put Approve and Deny on the ask, but today the answer still
  happens in Claude Code. Making Starfish answer means the hook waits for a broker verdict, so the hook
  timeout (10 s today) would have to grow. Claude Code's prompt would also stop being the place where the
  person says yes. That is a product decision, so it is left for the next step.
- **Seen markers from a UI.** `SessionRegistry.markSeen()` exists, but no reader can call it yet, because
  only the daemon writes the snapshot. A UI needs a small authenticated request to the daemon.
- **Desktop push.** The desktop app's `subscribe` still never fires. The sidecar stream now carries
  sessions, so the desktop can consume that stream instead of polling.
- **Per-session budgets, machines, Codex.** There are no budget scopes on sessions yet, one daemon serves
  one project on one machine, and only Claude Code hooks are wired.

## Files

- `packages/governance-core/src/sessions.ts`: the registry, derived state, attention order and the
  snapshot reader.
- `packages/governance-core/src/broker.ts`: the `channel` and `sessionId` fields and `settle()`.
- `packages/governance-hooks/src/daemon.ts`: recording, ask mirroring and branch detection.
- `packages/governance-hooks/src/handler.ts`: `sessionId` on calls, plus the orphan-post fix.
- `packages/governance-overlay/bin/starfish.mjs`: the daemon wiring, the hook fields, the extra installed
  events and `starfish sessions`.
- `packages/sdk/src/serve.ts` and `index.ts`: `GET /v1/sessions` and the `sessions` stream event.
- Tests:
  - `sessions.conformance.test.ts` (core)
  - `daemon.sessions.conformance.test.ts` (hooks, over a real socket)
  - `sessions.sidecar.conformance.test.ts` (sdk)
