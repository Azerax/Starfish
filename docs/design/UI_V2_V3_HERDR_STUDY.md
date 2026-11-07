# UI v2 and v3: what herdr does better, and two new versions

Written 2026-11-07, after Scott pointed at [herdr](https://github.com/herdrdev/herdr) ("this blows our UI
away"). herdr is an Apache-2.0 Rust terminal workspace for coding agents. A local clone (commit `ee5bfb50`, 2026-10-29) was studied read-only. Nothing of it was built or run. **Only ideas were taken. No herdr code, glyph tables or assets are copied into Starfish.**
That matches the clean-room note in [UI_LINEAGE.md](UI_LINEAGE.md).

Mockups (static HTML, fake data), in [`docs/ui-mockups/v2/`](../ui-mockups/v2/):

| File | What it is |
|---|---|
| `before-bridge-calm-2026-11-07.jpg` | The Bridge as it ships today: Calm theme and the dev mock bridge, 1440×900 |
| `v2-herd-cockpit.html` / `.png` | **v2: Herd Cockpit.** Desktop app, agent-first, dark and light (button at top right) |
| `v3-terminal-console.html` / `.png` / `-goto.png` | **v3: Console.** `starfish console` in a terminal; press `g` for the go-to picker |
| `v2-calm.html` / `.png` / `-all-clear.png` | **v2 calm (the one to build).** One question on screen; `#clear` shows "Nothing needs you" |
| `v3-calm.html` / `.png` / `-details.png` | **v3 calm (the one to build).** One ask on screen; `space` (or `#details`) opens the details |

## Calm cut: the versions to build (Scott, 2026-11-07)

Scott liked both dense versions but called them **"overwhelming information"**. The calm cut keeps the
herdr ideas and removes everything that does not answer one of three questions:

1. **Does anything need me?** The list has two groups, "needs you" (with wait times) and "everyone
   else". There are no machines, branches or second lines in the list.
2. **What is it, and is it OK?** The screen holds one ask, written as a plain question ("Commit 3 files to
   fix/serve-verdict…?"). It shows the commit message, one sentence on why it needs you, the risk as a
   single word, and Approve / Deny.
3. **Is everyone else fine?** Glyphs in the list, a green dot for "finished, not seen", "✓ governed" in
   the header, and one line of spend.

Everything else is **one click or key away, not on screen:**

| Moved out of the main view | Where it lives now |
|---|---|
| Files, diff, boundary, capabilities, matched rule, the agent's last steps | **Details** (v2) / **space** (v3) |
| Each agent's decision log and the live feed of all agents | The `activity` view |
| Audit chain, sweep, monitor, tolerance | The `audit` view; the header shows only "✓ governed", or a warning when something is wrong |
| The cross-agent queue column | Gone: the "needs you" group *is* the queue, and **N** names the next item |
| Machines, branches, offline machines | The agent's details and the go-to picker (`Ctrl K` / `g`) |
| Budget meters per agent | One line ("$6.40 of $10 today"), plus a warning only when a cap is hit |
| Status bar counts, filter chips, key lists, toasts | Dropped from the default view; `?` lists keys; notifications stay but only for asks |

When nothing needs you, the main view says so in one line ("Nothing needs you. Two agents are working…")
and offers to show what a finished agent did. That is the screen the operator sees most of the time.

The dense mockups stay in the folder as a map of what the details and views contain, not as screens to
ship.

**Decision (Scott, 2026-11-07):** after seeing `v2-calm` and `v3-calm`, he said "Yes, this level". This
amount of information is the target for both versions. New panels or numbers on the main view must earn
their place against the three questions above, or go behind Details or a view.

To view them, open the HTML files in a browser, or serve the folder:
`python -m http.server 5191 --directory docs/ui-mockups`.

## The one-sentence difference

herdr is organised around **agents**: who is stuck, where, on which machine. Today's Starfish UI is
organised around **decisions**: a queue of tool calls with no agent, project or machine attached. The
queue in `before-bridge-calm-2026-11-07.jpg` shows "Worker · git_commit" twice, and nothing says which
session or repo either belongs to. herdr's whole promise is "never hunt for the stuck one". For a
governance product, the stuck one is the agent waiting on your approval.

## What herdr does that is worth taking

Ranked by value to Starfish. The herdr source for each is in its repo under `src/client/shell/`.

1. **An agent list as the spine of the screen.** The list is grouped machine › workspace (repo, with its
   branch) › agent, and every row carries a state. Starfish's equivalent is the fixed "Crew" (Orchestrator,
   Planner, Intake…). Crew is a list of roles, not the Claude Code or Codex sessions the operator actually runs.
2. **One attention order, used everywhere.** herdr ranks blocked › done › working › idle › unknown, then
   most recent. The same function sorts the list, rolls a group up to its worst child, and drives the
   counts. For Starfish: *waiting on you* › *done, unseen* › *working* › *idle* › *unknown*. *Denied* is a
   tag, not a state.
3. **Roll up the worst child.** A collapsed machine or project shows the glyph of its most urgent agent,
   so a hidden approval is never invisible.
4. **Shape plus colour.** herdr's own default (dots that differ only by colour) is its weak spot. Its
   `symbols` option fixes that, so we start from shapes: `◆` waiting on you, `◐` working, `✓` done,
   `○` idle, `·` unknown, `×` last call denied.
5. **"Done, unseen" is a state.** A finished agent stays marked until it has actually been shown on a
   focused screen. Each viewer clears it for themselves. This covers the work that finishes while you are
   approving something else.
6. **Notifications that check before they speak.** Wait about 1 s, check the item is still pending, show
   one notification per agent (newer replaces older), cap the queue, show nothing for the agent on screen,
   and keep "needs you" up longer than "finished" (8 s vs 5 s). A request sound always plays; a completion
   sound plays only for background agents; each source can be muted.
7. **One key to the oldest waiting item**, on any machine (herdr: `prefix+o`, or click the toast).
8. **A go-to picker** with multi-word search, one-letter state filters (`b w d x`), a tree with
   right-aligned kind and state columns, a footer with the path of the selected row, and an
   always-visible key-hint line.
9. **A mode pill plus key hints** in the bottom bar (` APPROVALS  a approve  d deny  g go to  ? keys`).
   The shortcuts are discoverable without a help screen.
10. **Strict and explainable.** herdr never infers "safe" from a missed match, and it can say which rule
    classified a pane. For Starfish, every ask shows the rule that put it in the queue, with an
    `explain` link (the CLI already has `starfish policy explain`).
11. **Stale data stays, dimmed.** A machine that drops keeps its last known state on screen, greyed out,
    with acting on it disabled. Reconnecting never steals your selection.
12. **Very little chrome.** herdr keeps permanent lines to a minimum, packs its rows, labels in lowercase,
    separates with ` · `, and shows focus with brightness and weight instead of boxes. Today's Bridge
    header has ten pill controls.

## What not to take

- **herdr's look itself** (Catppuccin Mocha, its exact glyph set as a table). Both mockups use Starfish's
  own Calm tokens from `theme/themes.ts`. "Waiting on you" reuses Calm's `ask` purple, not herdr's red,
  because in Starfish red already means *deny*.
- **The unreviewed plugin marketplace.** That is the wrong model for a governance product, which vets
  capabilities before enabling them.
- **"Idle" as a signal of safety.** herdr's own docs warn that idle is not authorisation to approve.
  Starfish's broker stays the only authority.

## v2: Herd Cockpit (desktop)

`docs/ui-mockups/v2/v2-herd-cockpit.png`. It keeps D5's queue-plus-context idea, but turns it around so
the agent comes first.

- **Left rail, "agents · by attention":** machines › projects (number, name, branch, rolled-up state) ›
  agents. Each agent has a state and a one-line "what": the pending tool and risk, the last allowed call,
  or "finished 3m ago · 0 denied". There are filter chips (`all / blocked / working / done`), budget meters
  pinned at the bottom, and an offline machine shown dimmed and read-only.
- **Centre, the selected agent:**
  - Its header: agent, project, machine, branch, session, and "blocked on you · 0:42".
  - Its pending call: the tool call itself in mono; **files and +/- counts for a commit**; why it needs
    you, plus the matched rule; boundary and capability chips with the one asked for highlighted; a reason
    box; **Deny `D` / Approve `A`**.
  - This agent's own decision log for the session, height-capped, with a link to Activity.
- **Right column:** the queue across every agent, oldest first; integrity (audit chain verified, last
  sweep, tolerance, monitor); and the keys.
- **Bottom status bar:** governed state, counts by state, last-hour allow/ask/deny, global budget,
  machines.
- **Toast:** "codex needs you" with `O` open / `Esc` later, following the rules in point 6.
- **One-screen rule kept:** everything actionable fits at 1440×900, lists are capped, and the Activity
  stream stays on its own tab. The `approvals 3` tab count is allowed under
  [UI_ONE_SCREEN.md](UI_ONE_SCREEN.md), because it counts only things that need the operator. Routine
  denials never raise a badge.

## v3: Console (terminal)

`docs/ui-mockups/v2/v3-terminal-console.png` and `…-goto.png`. This is direction D4 (the TUI) from
[UI_DIRECTIONS.md](UI_DIRECTIONS.md), done herdr's way, for the audience that lives in a terminal next to
Claude Code.

- **Sidebar:** `spaces` (projects, rolled up, branch dim underneath), `agents` sorted by priority
  (line 1 is machine · project, line 2 is agent and state), and `budget` as text meters.
- **Main:** tabs (`approvals 3 · activity · audit · budgets · policy`, plus chain and sweep status
  on the right).
  - "waiting on you · oldest first" table.
  - A focused box for the selected ask: message, files, why, rule with `e explain`, boundary, may use,
    recent calls, and **a diff of the change on the right**.
  - A capped "live · all agents" feed.
- **Bottom mode bar:** ` APPROVALS ` pill plus key hints, and counts on the right.
- **`g` opens the go-to picker:** search, a tree by machine › project › agent, state filters, and
  "a approve here".
- **Two ways it could ship:**
  1. As `starfish console` from the existing npm CLI (`packages/governance-overlay/bin/starfish.mjs`),
     reading the same sidecar API that `starfish serve` already exposes.
  2. **Inside herdr.** Starfish reports "blocked" for a pane while a call waits
     (`herdr pane report-agent --state blocked`), so herdr's own sidebar, toasts and sound fire. A herdr
     custom command opens `starfish console` as a popup on the prefix key.

     This is the cheapest way to reach herdr users, and it fits Starfish's embed-everywhere story. It has
     not been tested against herdr's API. Read herdr's `socket-api.mdx` and `integrations.mdx` before
     committing to it.

## Built today vs. what each version needs

Starfish's rule is to state every gap openly, so: the mockups show **proposed** behaviour. The current map of the
app is from a read of `packages/desktop/app/src/` and `packages/desktop/src/` on 2026-11-07.

| Shown in v2/v3 | Today | Needed |
|---|---|---|
| Agents as sessions, grouped by machine and project | **Not built.** Only fixed crew roles (`getCrew`). The hooks daemon keeps an in-memory `HookSession` map that is not exposed | A session registry: `{sessionId, agentId, cwd/projectRoot, branch, host, model, startedAt, lastActiveTs, currentTool, pendingDecisionId, budgetScope}`, exposed on the bridge and the sidecar |
| Claude Code / Codex asks in the queue | **Not built.** Hook asks return `permissionDecision:'ask'` to Claude Code's own prompt and never reach the broker or the desktop | Route hook asks to the broker (keep Claude Code's prompt as the fallback) |
| "Waiting on you" state, wait timer | **Not built.** There is no such crew state | Join `broker.list()` to sessions by actor or refId |
| `sessionId` on every audit record | **Not built** | Add the field to `AuditEvent` |
| Live updates, toasts, sounds | **Not built.** `subscribe` is wired in preload, but main never emits; every screen polls (2–2.5 s) | Emit events from main; reuse the sidecar's SSE `/v1/stream` |
| Risk score 40 / 60 | Built, but tier-only: every score is 20, 40, 60 or 90 (`assessmentFromTier`), and agent-run asks are hard-coded `high` | The full band scale already exists in `riskmatrix.ts`; pass the real score through |
| Reason box written to the audit record | **Broken.** The note is sent as `intent.note` and dropped by main | Keep it in the audit event |
| Diff / files changed for a commit | **Not built** (D1 asked for it) | Attach a preview to the ask |
| Matched rule + `explain` | Partly built: CLI `starfish policy explain` exists; the UI shows only `reason` | Return the rule id with the decision |
| Keyboard (`A D J K N O`, `Ctrl+K`, `g`) | **Not built.** The app has no shortcuts | Key handlers plus a palette |
| Per-agent budgets | Built (`getBudgets`: global plus per scope) | Map a budget scope to each session |
| Audit chain verified, last sweep | Built: `audit/verify` on the sidecar, monitor counters. `lastSweepTs` is currently just "now" | Show the real sweep time |
| Machines and reconnecting state | **Not built** | One sidecar per machine, joined in the UI, like herdr's remote machines |
| Done, unseen | **Not built** | Per-viewer "seen" marker |

**Both versions stand on the first three rows.** Until Claude Code sessions and their asks reach the
broker, Starfish can't show the herd, whatever the screen looks like. That is the real gap herdr exposes,
and it is backend work, not CSS.

## Faults found in today's UI along the way

From the same read. Each was checked in code; none was fixed here.

- **Activity is a dead end:** it has no back link. **Home can't be reached again** after launch, because
  no header has a Home link.
- **Wrong link:** Home's "review" link goes to Comm, not the Bridge queue.
- **`.btn` has no CSS rule.** Comm, Padd, Settings and Onboarding buttons are unstyled.
- **Fleet wording leaks into the calm default:** "Report for duty", "You have the conn", "Enter the
  Bridge", the default operator "Grand Admiral Scotticus", and a "Transporter screen" that doesn't exist.
  The splash is still "GCS Starfish / Galactic Command".
- **Home ignores the theme.** Its colours are hard-coded, so dark mode doesn't reach it.
- **The approval note is dropped**, and `detail.notes` is fetched but never shown.
- **The renderer's `bridge/types.ts` has drifted** from the contract of record `packages/desktop/src/ui-contract.ts`
  (`getTasks` shape, `UiIntent` kinds).
- **The current Bridge needs a scrollbar at 1440×900** (see the "before" screenshot), against the
  one-screen rule.

## Recommendation

1. **Data first:** the session registry, hook asks routed to the broker, `sessionId` on audit records,
   and push events. Without these, v2 and v3 are pictures.
2. **Then v3 calm.** It is the smaller build, it serves the CLI audience who run Claude Code in a
   terminal, and the herdr route puts Starfish in front of herdr's users without a new app.
3. **Then v2 calm in the desktop app.** It replaces the Bridge as the default screen: the agent list and
   one ask, with details on demand. Fix the faults above in the same pass.

Build the calm cuts, not the dense mockups. See "Calm cut" above.

The agent rail is also the most credible answer yet to the "living floor" wish in
[UI_LINEAGE.md](UI_LINEAGE.md). It shows whole crews of agents at a glance, at scale, without the
toy look.
