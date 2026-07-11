# Project Starfish — UI & Theme Design Spec (Starfleet)

> **Version:** 1.0 · **Date:** 2026-06-04 · Ring-3 (presentation) companion to the Master Build Plan.
> Theme: **U.S.S. Starfish** — a starship bridge where governed agents run "missions." Star-Trek-Starfleet flavored.
> This is presentation only — zero impact on the governance core. Lands in the theme/packaging phase.

---

## 1. Concept

The harness is a **starship bridge**, the **GCS Starfish** (Galactic Command Ship). The user is **Grand Admiral Scotticus** of **Galactic Command** — the final authority. Each agent is a **bridge officer** at a station. **Every task is a "mission."** Work flows through the ship the way a governed task flows through the lifecycle — which is the whole point: the theme is a faithful visualization of the governance architecture, not decoration.

### 1.1 Cast & callsigns (IP-safe Fleet pack)

Names are "inspired by, not copied from" — the distributed **Fleet** theme uses these; a closer personal skin can vary (theme-pack architecture). Compliance notes per the Risk & Compliance Registry (L-1).

| Role | Fleet name | Inspired by | Compliance |
|---|---|---|---|
| Galactic Command (you) | **Grand Admiral Scotticus** | The Admiral | Safe — generic rank |
| Mission Director (orchestrator) | **Captain Mykel** | Kirk/Picard | Safe |
| Strategic Advisor (prep) | **First Officer** | Spock | Safe — pure generic rank (resolves the earlier "Spokk" flag) |
| Intake Control (vetting + routing) | **Oh Brian** | O'Brien | Safe-ish — real-name pun |
| Compliance Watch (monitor) | **Constable Gooey** | Odo (the changeling) | Safe — generic title + original comedic name; the goo homage isn't a protectable mark |
| Mission Planner | **D8A** | Data | Safe — android serial / generic word |
| Execution agents | **Deck Crew** | Starfleet crew | Safe — generic |
| The ship | **GCS Starfish** | Enterprise | Safe — original designation |
| The org | **Galactic Command** | Starfleet | Safe — generic |

Agent first-name labels (Michael/Dwight/Toby/Hank/Pam) remain valid internal IDs; the Fleet names are display personas.

## 2. The core convergence — the UI *is* the governance model

Every element of the reference layout maps to a real governance construct. Build the theme by binding these surfaces to live state, not fake readouts.

| Bridge UI element | Governance construct |
|---|---|
| **Mission** | A task (framework §3.2 "all work is a task") |
| **Mission Console phases** (Intake·Analysis·Planning·Execution·Review·Report) | The task lifecycle (`backlog → analysis → planning → decomposition → execution → validation → completed`); decomposition folds under *Planning* in the UI |
| **Activity Feed** | The audit log (`audit.jsonl`, the eight domains) |
| **Starfleet Command / "Awaiting mission update"** | Human-in-the-loop escalation surface (§10 final authority) |
| **Ship Status** (crew / systems / operations) | Service registry heartbeats + token telemetry + agent roster |
| **Shields / "deny-all"** | Default-deny policy posture (the Permission Gate) |
| **Transporter room** (things "beam in") | Capability intake — nothing boards unvetted (Toby) |
| **Security office alerts** | Hank's findings + risk tiers |
| **Redshirt casualty** | An agent in a terminal failure state (see §8) |

## 3. Bridge layout (from the reference)

- **Center:** the Captain's chair (Michael) facing a **main viewscreen** that shows the current mission / star field.
- **Flanking stations:** First Officer (Dwight) and Ops (Pam) forward; Security (Hank) and Transporter/Intake (Toby) to the sides.
- **Right rail — Mission Console:** Objective · Mission Phase tracker (the 6 phases with checks/active/locked states) · Activity Feed · Ship Status.
- **Upper area — Starfleet Command:** the Admiral (you) portrait + mission-update/escalation state.
- **Lower strip — Engineering & Operations crew:** the generic worker officers at consoles.
- **Bottom bar — Active Agents:** crew cards with live status (Commanding / Advising / Vetting / Monitoring / Planning / Working).

## 4. Character designs

Each officer = one agent, with a Starfleet persona, a station, animations, and in-character status lines. The persona never changes the governance role — it *narrates* it.

**Michael — Captain (orchestrator / GOD).** Command-red tunic, captain pips, center chair. Animations: reviewing mission, standing for alerts, giving orders. Lines: *"Mission accepted." · "Prepare execution plan." · "Escalating to Starfleet Command."* Governance: routes/adjudicates; privileged in role, gated in mechanism; escalations go to the Admiral.

**Dwight — First Officer (Spock-style, prep assistant).** Science-blue, Vulcan-calm bearing, PADD in hand. Lines: *"Analysis complete." · "Additional context acquired." · "Probability of success: 87%."* Governance: enriches/advises queued missions; headless prep brought under the gate.

**Toby — Transporter Chief (O'Brien-style, capability intake).** Transporter room beside the bridge. Theme: *nothing enters the ship without inspection.* Incoming tasks/capabilities literally **beam in** on the pad. Lines: *"Capability request detected." · "Running intake checks." · "Pattern accepted."* Governance: the sole intake path; vets, scores, auto-adds Low / quarantines the rest.

**Hank — Security Chief (Odo-style, monitor).** Security office adjacent to the bridge: monitors, alert lights, status displays. Lines: *"Policy violation detected." · "Monitoring execution." · "No intervention required."* Governance: periodic semantic sweep; **report + escalate only**, never intervenes directly.

**Pam — Ops Officer (Data-style, planner).** Main Ops station with a large console showing **mission graphs / workflow trees** (the task DAG). Lines: *"Decomposing mission." · "Generating work breakdown." · "Creating execution plan."* Governance: turns idea-board clusters and missions into governed task drafts.

## 4.5 Two ways work enters the ship — PADD (green) vs COMMS (blue)

The single most useful metaphor in the theme, because it's a real routing distinction in the governance system, not just a visual. **Oh Brian (Intake Control)** classifies every inbound request and routes it:

**PADD orders — deterministic skill invocation (green route).** A PADD is a *known, registered, already-vetted capability* (`chroma.search`, `oc.skill.task.create`, `read_file`, `update_memory`, `invoke_tool`). The work is deterministic: hand the crew member a glowing PADD, they walk to their station, execute, return a result. Seconds.

```
You/Michael → PADD → Oh Brian: "capability verified, routing directly" → Deck Crew → Result
```

Governance still applies — the PADD invocation passes the Permission Gate (allowed agent · task-bound · policy · risk) and is audited — but because the capability is pre-approved and the path is deterministic, there is **no bridge planning cycle.** This is the framework's deterministic core (§3.3) made visible.

**COMMS requests — open-ended reasoning (blue route).** Unknown work arrives as an incoming transmission ("research OCI grants," "investigate the outage," "build a migration strategy"). It can't be a single known skill, so Intake Control escalates it to the bridge for a full **mission**:

```
You → COMMS → Oh Brian: "unstructured request, mission planning required, escalating to bridge"
   → Captain Mykel (triage) → First Officer (enrich) → D8A (plan/decompose) → Deck Crew (execute) → Review → Done
```

Minutes-to-hours; this is where bounded autonomy operates, every step governed and audited.

**Why it matters:** users instantly understand *why some requests are instant and others take planning* — and it cleanly separates the deterministic, cacheable, low-risk skill path from the reasoning path that needs orchestration and review. Both are governed; only the routing differs. Intake Control's third route is a **brand-new capability request** → the Toby/Oh Brian vetting pipeline (§ master plan / detailed plan Phase 5).

### Skill Library (the registry, made visible)

A room of glowing **PADD shelves** — each shelf an installed, registered skill (`oc.skill.task.create`, `oc.skill.tool.invoke`, `chroma.search`, `memory.lookup`). A crew member walks to the shelf, retrieves the PADD, returns to station, executes. Visually, this *is* the Capability/Tool/Skill registry: if a PADD isn't on the shelf, it doesn't exist, and nothing un-shelved (un-registered) can be picked up — default-deny, dramatized.

### Communications Center (the inbound surface)

A dedicated room receiving user requests, external messages, and agent reports — scrolling transmissions, blinking arrays, incoming-message alerts. This is where COMMS missions and external/untrusted inputs (Slack, web) arrive and get tagged before they ever reach the bridge.

## 5. Worker agents (the crew)

Generic, unnamed officers by department: **Engineering · Science · Medical · Operations · Research · Maintenance.** They walk between consoles carrying PADDs; a status label floats overhead — **Working / Researching / Executing / Waiting.** Each is a governed worker agent; the department is just its lane.

## 6. The Mission Console (right rail)

The mission lifecycle made glanceable:

- **Objective** — the mission's goal (task subject).
- **Mission Phase** — the six-step tracker; completed steps checked, current step active, later steps locked. A mission cannot reach **Report** without passing **Review** (the `validation` gate — reasoning standard §8 enforced by the lifecycle, not the prompt).
- **Activity Feed** — timestamped audit events (mission received → intake complete → context gathered → plan generated → execution started …).
- **Ship Status** — crew count, systems %, operations % = roster + service heartbeats + telemetry.

**Mission Status counters** (a glanceable header strip, each bound to live state):

```
🟢 PADD ORDERS   12 completed today     (deterministic skill invocations — audit count)
🔵 COMMS MISSIONS 3 active              (open reasoning tasks in flight)
🟡 BRIDGE REVIEW  1 awaiting approval    (HITL / validation queue → Galactic Command)
🔴 ALERTS         0                      (Hank/Constable Gooey findings, gate denials, casualties)
```

## 7. Starfleet Command = the Admiral (you)

The human is **Starfleet Command**. Escalations (`ask`, Critical-tier actions, Hank's High/Critical findings, budget hard-limits) surface here as "mission update required." Approving/denying from this panel is the native HITL gate — the same decisions, in uniform. The system is always interruptible; the Admiral can pause, redirect, or abort a mission.

## 8. Redshirts (casualty feature)

When an agent hits a **terminal failure** — Critical violation caught by Hank, killed by the gate, crash, or a failed mission with no retries — its officer dons a **security-red** shirt and is logged as a casualty (counter on Ship Status / security office). It makes failure glanceable and points straight at the audit log. Canon rule that reinforces determinism: *nobody falls at random — a redshirt drops only to a real violation or failure, so if one falls, check the log.* (Security/ops officers wearing red is also period-correct, which is why Hank's lane is red.)

## 9. Mission narrative (the OCI-grants example)

Every task renders as a mission dialogue — the governed flow, in character:

```
Admiral:        Find all OCI grants for this company.
Captain:        Mission acknowledged.                  (task created)
Spock:          Gathering company context.             (analysis / enrich)
Data:           Generating plan.                       (planning / decomposition → DAG)
O'Brien:        Required capabilities verified.        (intake / vetting if new caps)
Odo:            Compliance review complete.            (policy + risk pass, audited)
Engineering:    Executing mission.                     (execution under the gate)
```

This is the audit trail and task lifecycle, narrated. Great for a demo and for legibility.

## 10. Visual asset inventory

**Ship / tileset:** bridge floor · LCARS wall panels · command chairs · viewscreens · turbolift doors · tactical station · ops station · ready room · transporter pad · engineering warp core · hallways · **Communications Center** (transmission arrays) · **Skill Library** (glowing PADD shelves).
**Characters:** Captain Michael · First Officer Dwight · Toby (transporter) · Hank (security) · Pam (ops) · 10–20 generic crew (per department, multiple skins).
**UI:** LCARS-style panels · mission alerts · status bars · crew cards · ship-status displays · the Mission Console.

## 11. Build mapping

- **The bridge scene** (floor, officers walking, station nodes, beam-in effect, redshirt state) = the **Pixi.js** layer, salvaged from the fork's office floor and re-tiled/re-sprited. Same engine (camera, pathfinding, sprites, bubbles); new tilemap + sprite sheets.
- **The console chrome** (Mission Console, Starfleet Command, crew cards, status bars, the LCARS frame) = the **React** layer, restyled. Bound to live governance state (tasks, audit, registries, telemetry).
- All **ring 3**: it consumes the governance core, changes none of it. Sequenced in the theme/packaging phase so it never blocks governance work; the LCARS chrome can begin earlier (pure CSS/React) than the bespoke tileset (needs art).

## 12. IP & licensing — read before this ships as a product

The brief evokes Paramount/CBS *Star Trek* IP: **LCARS** trade dress, "**Starfleet**," "**U.S.S.**/NCC" registry, the combadge/delta, TOS uniform specifics, and Spock/Data/Odo/O'Brien likenesses. For your **personal/internal** instance, theme it however you like. For the **sellable overlay product**, that IP is a real legal/financial risk — not legal advice, but the safe path is to keep the *genre* and drop the trademarks: a retro command-console aesthetic, a generic "fleet command," original officer designs not modeled on named actors, and an LCARS-*inspired* (not LCARS-replica) panel language. This is also why the asset note matters: **produce original, commercially-licensed art** rather than reusing Trek assets. (The reference image is a great direction-setter but is concept-grade, not production art you'd want to ship.)

## 13. Open decisions

- **Asset sourcing:** commission a pixel artist (bespoke, clean license) vs. license a commercial sci-fi pixel pack and recolor vs. AI-generate base art and clean up. This is the single biggest ring-3 cost.
- **Commercial vs. personal theme split:** ship the product with an IP-safe "fleet" theme while keeping a full-Trek skin for personal use? (A theme-pack architecture makes this trivial — themes are just asset bundles + a palette.)
- **Scope tier for v1:** light reskin (re-tiled floor + LCARS chrome) first, full bridge-stations layout later.
