# Slash-Command Governance Plan

> How a CLI user's `/command` (slash command / skill invocation) is brought under Starfish
> governance. Companion to `GOVERNANCE.md` (constitution) and `docs/SKILL_ISOLATION_THREATS.md`.
> Status: **plan / not yet built.** Targets the *overlay* deployment mode (Starfish wraps Claude
> Code; Claude Code runs the model and holds the key — Starfish governs from outside via hooks).

## 1. The problem

A slash command is **not a tool call**. When a user types `/foo`, Claude Code *expands* the
command's markdown into a prompt and feeds it to the model — there is no `PreToolUse` event for the
invocation itself. So the existing PDP-via-`PreToolUse` seam only sees the *tool calls the skill
later makes* (Bash, Edit, Write, MCP), not the act of invoking the skill. Three things therefore go
ungoverned without extra work:

1. **Existence** — an unvetted skill can be present and invokable.
2. **Invocation** — a quarantined / rejected / tampered skill can be triggered.
3. **Provenance threading** — the skill's later tool calls aren't bound to the skill's identity
   (capabilityId) or a task, so authority can be laundered through the effect layer.

## 2. The interception model — three layers

A `/command` must pass three independent gates. Only Layer 2 is genuinely new; Layers 1 and 3 reuse
machinery that is already built and tested.

| Layer | Question | Mechanism | Status |
|---|---|---|---|
| **1 — Shelf** | May this skill *exist*? | `starfish govern` materializes **only vetted** skills into `.claude/skills` / `.claude/commands`; quarantined/rejected/injection-tier are never placed. Registry made physical: un-shelved = un-registered = uninvokable. | partial (`govern` exists; "materialize only vetted" is new) |
| **2 — Invocation** | May this skill *be invoked, now*? | `UserPromptExpansion` hook (matched on command name) → name→capability lookup in `CapabilityLedger` + **verify-before-invoke** (hash integrity) → allow / block. Opens a governed task + sets the active `capabilityId` for the turn. | **new** |
| **3 — Effect** | May its actions *run*? | Every Bash/Edit/Write/MCP call → `PreToolUse` → `handleHook` → `pdp.decide('ingress', …)`; boundary-contained, default-deny, **task-bound + capability-bound** (inherits the task/capabilityId from Layer 2). | built |

Claude Code facts this relies on (verified against the Hooks reference):
- `UserPromptExpansion` fires *"when a user-typed command expands into a prompt, before it reaches
  Claude"* and **can block the expansion**; its **matcher is the command/skill name**.
- Blocking: exit code 2 (stderr → Claude) **or** JSON `{"decision":"block","reason":"…"}` on exit 0.
- On allow, `UserPromptExpansion` stdout is **added as context the model can see** — usable to
  stamp a governance banner / the opened task id into the expanded prompt.
- `PreToolUse` already gates every tool call and MCP tools appear as normal tool events.

## 3. Hook contract (Layer 2)

Claude Code invokes `starfish hook --event UserPromptExpansion`, passing event JSON on stdin:

```jsonc
// stdin (shape per Claude Code)
{ "hookEventName": "UserPromptExpansion", "command": "foo", "promptText": "...expanded...", "cwd": "/proj" }
```

`starfish hook` boots/attaches the project `Governor`, then:

```
name        = payload.command
cap         = ledger.findByName(name)              // capability lookup by command name
if !cap                      -> BLOCK "unknown skill: not in registry (side-loaded?)"
if cap.status == 'rejected'  -> BLOCK "skill rejected at vetting (injection/destructive)"
if cap.status == 'quarantined' -> BLOCK "skill quarantined — approve via `starfish approve`"
integ = integrityGate.verify(cap.id)               // verify-before-invoke (hash)
if !integ.ok                 -> quarantine(cap.id); BLOCK "integrity drift since vetting"
task  = tasks.open({ origin:'slash', capabilityId: cap.id, agentId })  // no task, no tool
emit audit 'slash-allowed' (cap.id, task.id)
-> ALLOW; stdout banner: "[governed: skill <name> · task <id> · capability <id>]"
```

Output contract:
- **Block** → exit 2 with reason on stderr (also audit `slash-blocked`), prompt is erased.
- **Allow** → exit 0; stdout banner is injected as context so the rest of the turn carries the task
  id; the active `(agentId → capabilityId, taskId)` binding is persisted for the `PreToolUse` seam.

## 4. Binding the effect layer to the invocation

The whole point: a skill's later tool calls must be provably *that skill's*. On allow, Layer 2
writes the session binding `(agentId → { capabilityId, taskId })` into the **resident `starfish
daemon`** (decided §10). The `PreToolUse` `HookContext` reads it so every downstream
`ToolCall` is stamped with that `capabilityId` and `taskId`:
- **task-binding** ("no task, no tool") — calls with no open task are denied.
- **capabilityId binding** — the confused-deputy check already in `handleHook` rejects a payload
  claiming a different capability than the one bound at expansion.
- the task is closed on `Stop` (turn end), so the binding can't outlive the invocation.

## 5. Components & file changes

**governance-core (ring 1):**
- `vetting.ts` / `CapabilityLedger` — add `findByName(name)` (commands are looked up by name, not id)
  and ensure capability records carry the slash/command name + contentHash for verify.
- reuse existing `IntegrityGate.verify`, `enforceIntegrity`, `quarantine`, `TaskLedger.open`.

**governance-hooks (ring 2):**
- `handler.ts` — add `handleExpansion(payload, gov, ctx): HookResponse` (the Layer-2 decision above),
  alongside the existing `handleHook` (Layer 3).
- session binding store: extend `HookSession` / `PdpDaemon` to hold `(agentId → {capabilityId, taskId})`
  set at expansion and read at `PreToolUse`. The **daemon is the authoritative store** (no on-disk
  session file), so the binding can't be tampered with between layers.

**governance-overlay (ring 2) — the CLI:**
- `bin/starfish.mjs` — add subcommands:
  - `starfish init` — write Claude Code `settings.json` hooks: `UserPromptExpansion` (matcher = all
    governed command names), `PreToolUse`/`PostToolUse`/`Stop` → `starfish hook --event <e>`; create
    `.starfish/` (audit, registry seed); start `starfish daemon`; **auto-register the curated
    built-in slash commands into the registry as trusted** (see §5a).
  - `starfish hook --event <event>` — stdin→stdout shim: route `UserPromptExpansion`→`handleExpansion`,
    tool events→`handleHook`; print the decision JSON / exit code.
  - `starfish daemon` — **required**: holds the session-binding store and keeps the `Governor`/
    `PdpDaemon` + registries warm over a local socket. Hooks attach to it each call.
  - `starfish approve <id>` — promote a quarantined skill (operator consent) — already most of `govern`.
- `govern.ts` — add **materialize-only-vetted**: place passing skills into the Claude Code skills dir;
  withhold quarantined/rejected (Layer 1).

## 5a. Built-in slash commands (decided)

Claude Code's own built-ins (`/clear`, `/help`, …) and Starfish's own commands are handled by a
**curated allow-list that `starfish init` auto-registers into the `CapabilityLedger` as trusted**
(publisher = `starfish/builtin`, Low tier). They are *real registry entries, not a bypass*: Layer 2
looks them up by name like any vetted skill, integrity-verifies the ones backed by a file, they show
up in the audit, and the operator can inspect or revoke them. Anything not on the built-in list and
not vetted stays unknown → blocked. A malicious skill that takes a built-in's name fails the trusted
publisher / integrity check, so name-squatting a built-in does not inherit its trust.

## 5b. Token Governor in overlay mode (decided)

Budgets **are enforced** for CLI users. `starfish hook` records usage into the `TokenGovernor` from
the `PostToolUse` / `Stop` payloads (Claude Code reports usage at turn end). Before allowing, both
`UserPromptExpansion` (skill invocation) and each `PreToolUse` first check `tokens.status(agentId)`:
`hard` ⇒ **block** with a resume reason (fail-closed), `soft` ⇒ allow + warn. Claude Code's usage
figures are coarser than Mode A's exact per-call accounting, so recorded numbers are approximate —
but the **hard-stop still fires**. Exact accounting is a later refinement (§9 P4), not a blocker.

## 6. Audit events (all hash-chained)

`slash-allowed`, `slash-blocked` (reason), `slash-integrity-drift` (+ auto-quarantine),
`task-open(origin=slash)`, plus the existing `ingress`/`egress`/`tool` events for the effects.
Hank gains a finding for repeated `slash-blocked` (probing) and any `slash-integrity-drift`.

## 7. Threat coverage

| Threat | Caught by |
|---|---|
| Side-loaded skill Starfish never vetted | L2 (unknown name → block); L1 (never materialized) |
| Quarantined/rejected skill invoked | L2 (ledger status → block) |
| Injection-tier skill (`ignore previous instructions…`) | vetting → `rejected` at intake; L2 blocks invocation |
| Skill file tampered after vetting (TOCTOU) | L2 verify-before-invoke (hash) → block + auto-quarantine |
| Skill's tool calls exceed its authority | L3 PDP + boundary (default-deny, task/capability-bound) |
| Confused deputy (skill A acts as skill B) | capabilityId bound at L2, checked at L3 |
| Hook not installed / bypassed | L1 (only vetted skills on the shelf) is the backstop; `starfish init` + a `SessionStart` self-check that warns if hooks are missing |
| Name-squatting a trusted built-in (`/clear` etc.) | built-ins are explicit registry entries (publisher `starfish/builtin`); a same-named side-loaded file fails the publisher + integrity check → block |

## 8. Test plan (conformance, deterministic, no real Claude Code)

Feed real Claude-Code-shaped `UserPromptExpansion` payloads through `handleExpansion`:
- registered + intact → allow + `slash-allowed` + task opened + banner contains task id.
- unknown command → block (reason mentions registry / side-load).
- quarantined / rejected → block with the right reason.
- tampered (contentHash mismatch) → block + auto-quarantine + `slash-integrity-drift`.
- binding: a subsequent `PreToolUse` for that agent inherits the capabilityId/taskId; a mismatched
  capability_id is denied (confused-deputy).
- `starfish init` writes a settings file containing all four hook events.
- `govern --apply` materializes only vetted skills; quarantined ones absent from the skills dir.

## 9. Phasing

- **P1 — core**: `findByName` + capability name/hash fields + tests.
- **P2 — hooks**: `handleExpansion` + **daemon-held** session binding + token-status checks + tests (the heart).
- **P3 — CLI**: `starfish hook` shim + `starfish init` installer (+ built-in allow-list seeding) + `starfish daemon` (binding store + warm registries) + `govern` materialize-only-vetted + token recording from `PostToolUse`/`Stop`.
- **P4 — hardening/UX**: `SessionStart` hook-presence self-check, Hank findings (slash probing /
  integrity drift), **exact token accounting**, docs.

## 10. Decisions (resolved 2026-06-15)

- **Binding store = resident `starfish daemon`.** The L2→L3 `(agentId → {capabilityId, taskId})`
  binding lives in the daemon (chosen over a stateless `.starfish/session.json`) for speed and
  tamper-resistance. The daemon becomes a required component, not an optional perf add-on.
- **Token Governor enforced in overlay mode (yes).** Usage is recorded from `PostToolUse`/`Stop`;
  `hard` budget blocks further expansions and tool calls (fail-closed), `soft` warns. Accounting is
  approximate but the hard-stop is reliable; exact accounting is P4. (see §5b)
- **Built-in commands auto-registered + trusted.** A curated built-in allow-list is auto-added to the
  registry as trusted at `starfish init` — real, inspectable, revocable entries, not a bypass. (see §5a)

## 11. Out of scope

Mode-A host execution (covered by `AgentLoop`/`Dispatcher`/`HostRunner`); model/key handling (Claude
Code owns the key in overlay mode); the desktop UI.
