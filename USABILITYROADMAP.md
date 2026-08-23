# Starfish Usability Roadmap
## From now → an above-average technical user creating with Starfish

> **Date:** 2026-07-13 · Grounded in the live repo (v0.23.0 local) and the existing plans it complements:
> `docs/USABILITY_ASSESSMENT.md`, `docs/BRIDGE_LIVE_PLAN.md`, `docs/PERSONAS_AND_GAPS.md`,
> `docs/MASTER_COMPLETION_PLAN.md`, `docs/LAUNCH_READINESS_PLAN.md`, `docs/OVERLAY_USAGE.md`.
>
> **Scope of THIS doc:** the shortest, honest path for a *technical* creator (the "Priya" persona —
> comfortable with npm/CLI, has their own API keys) to **start creating with Starfish**. It deliberately
> excludes the non-technical (Marcus) parity work and the full 1.0 GTM push — those live in
> `MASTER_COMPLETION_PLAN.md` / `LAUNCH_READINESS_PLAN.md`. Where they overlap, this doc points there
> rather than re-planning.

---

## 0. What "creating with Starfish" means (and why the answer is two tracks)

A technical creator can "create" with Starfish in two distinct senses, and they are at very different
maturity:

- **Track A — Starfish governs *your* building.** You keep using the agent you already drive (Claude
  Code), and Starfish sits underneath as a deny-by-default policy layer: every tool call authorized,
  contained, audited. You "create" exactly what you create today — code, files, whole projects — except
  now it is governed. **This works now** (your own assessment: 8/10).

- **Track B — you build *inside* Starfish.** You open GCS Starfish, type a brief, and a governed agent
  plans, runs, and produces artifacts under the PDP — with you as the human approver. This is the
  "connect and talk to it" product. **Correction (2026-08-01):** the line below — "dispatch is unwired,
  so an order in the app executes nothing" — is stale as of this date. A code read confirmed `Home`'s
  brief box already calls through `gov:requestAction` to a real `AgentLoop` run with real tool execution
  (`peps.ts`); the wiring is real, not a stub. What's actually missing is a **live, verified run** —
  see `docs/design/M3_DISPATCH_VERIFICATION_PLAN.md`. The "3/10" score below reflects the July 13
  snapshot, not today.

The roadmap below advances both, because a technical creator will want Track A immediately and Track B
as the differentiated product. **Track A is days–weeks of polish away; Track B is roughly one focused
sprint of wiring away.**

### Definition of Done — "a technical user can create with Starfish"

The roadmap is complete for this audience when all of these are observable by someone who is *not* Scott:

1. Install from a published artifact (npm and/or a signed desktop build) — no clone required.
2. Connect a model with their own key in one obvious step (key → OS keychain).
3. Either (A) govern a real Claude Code session end-to-end, or (B) type a brief in the app and watch a
   governed agent run it to a real artifact.
4. See every decision — allow, ask, deny — in a legible, scriptable audit (`starfish audit`, JSON out).
5. Trigger a deny on purpose (attempt something dangerous) and watch it get blocked + audited.
6. Find the finished artifact in an obvious place.
7. Do all of the above in **< 15 minutes**, reading no source code.

---

## Progress log

**2026-07-13 — M0 started; Track B found further along than the June assessment.**
- ✅ **`starfish audit`** shipped — read-only hash-chain viewer (`--json`, `--since <seq>`, `--limit <n>`, `--deny`, `--ingress`, `--verify`). Entirely in the `.mjs` CLI (zero `.ts` changes → no risk to the 420-test suite / API-surface gate); filter logic unit-checked 7/7. Run `npm run build:cli` to bundle it into the published CLI.
- ✅ **Daemon auto-start** shipped — the hook brings up the PDP on the first governed call and re-asks, staying **fail-closed** (if it can't start + reach the daemon it DENIES; opt out `STARFISH_NO_AUTOSTART=1`).
- ⏳ Remaining M0 (Scott): publish the v0.23 line; run `npm run ci` on Windows to confirm green; capture one full governed session as the proof artifact.
- 🔎 **Correction to §1 below:** `packages/desktop/src/{projections,peps,broker}.ts` and `main/index.ts` already instantiate `DecisionBroker` and wire `gov:requestAction → AgentLoop → PEPs`, with `DEV.*` now only fallbacks. So **BRIDGE_LIVE_PLAN Phases 1–4 (roadmap M1–M4) are largely built already** — the real open item is *runtime-launch verification*, not construction.

**2026-07-13 (later) — M1 headless verification run (Mode B).** Staged the repo source into the cloud, fresh Linux `npm install` (Electron binary skipped), then:
- ✅ **`typecheck:node` (main + preload — the live-Governor wiring) passes clean.** The dispatch/broker/PEP wiring compiles.
- ✅ **Renderer boots headless** via `dev:web` on `http://localhost:5173` (Vite ready, no errors).
- 🔧 Fixed **2 real renderer type errors** so `typecheck:web` is green too, and committed: `App.tsx` nav-prop mismatch (a `Bridge.go` call-site adapter) and `Bridge.tsx` (a `Verdict`-typed `eff()` helper so the 'asks' summary count is a legal comparison).
- ✅ **M1 CONFIRMED (2026-07-13):** Scott ran `npm run dev` on Windows and the **GCS Starfish desktop app launches** — Track B boots end-to-end (compile → renderer → live Electron window). Added root `dev`/`dev:web`/`dev:setup` passthroughs so `npm run dev` works from the repo root. **M1 is done.** Next open gate is M3/M4 *behaviour*: does typing a brief actually dispatch a governed agent run that produces an artifact.
- ✏️ **Correction (2026-07-15, Scott):** the **API-key requirement is NOT a gap vs OpenClaw** — OpenClaw also requires a provider API key at setup or it can't do anything. Starfish's onboarding already takes a provider key into the OS keychain, so that step is **parity**. A managed/hosted key tier is an *optional, beyond-OpenClaw* differentiator, **not on the critical path** to matching OpenClaw's ease. Workstream #5 re-ranked: guided BYO-key = table stakes (largely done); managed key = optional. This also corrects the "API-key wall" framing in `PERSONAS_AND_GAPS.md` / `LAUNCH_READINESS_PLAN.md` when measured *against OpenClaw* (it remains a real barrier only for a would-be user who refuses to ever get a key — whom OpenClaw doesn't serve either).
- ✅ **Full CI green in a clean Linux env (2026-07-15):** ran the whole `npm run ci` gate on the current source — typecheck, unit tests, **conformance 468/469 (1 skip)**, determinism, dependency-direction lint, secret-scan, IP-scan, and SBOM/license all pass; the `audit`-command CLI **bundles clean** (`build:cli`). This covers the **M2–M4 spine** (broker/dispatch/PEPs/agent-loop conformance = green) and de-risks the "run `npm run ci` on Windows" item. (Aside: a mid-check "edit not on disk" scare was a **stale `device_stage_files` read** — `git status` + a device-side grep confirmed every change is correctly on disk; the transfer bridge served a pre-edit copy.)

## 1. Where we are today (grounded)

| Capability | Track | State today | Evidence |
|---|---|---|---|
| Govern Claude Code, deny-by-default, audited | A | **Works, R0-verified** on CC 2.1.183 | `OVERLAY_USAGE.md`, `USABILITY_ASSESSMENT.md` |
| `init` / `install` / `daemon` / `doctor` / `attest` / `audit` CLI | A | Built + bundled; daemon must be started manually | `OVERLAY_USAGE.md` |
| Write-friction control (`--writes auto\|ask` + backups) | A | Built | `OVERLAY_USAGE.md` |
| Published install artifact | A/B | ✅ **Done (2026-08-01)** — `project-starfish@0.26.0` published to npm, provenance/tags as of this release | `npm view project-starfish version` |
| Governance core (PDP, audit, risk, dispatch, runner, agent loop) | B | Built + **300+ conformance/determinism tests green** | `README.md`, core tests |
| Desktop app observes live governor (crew/decisions/audit) | B | Phase 1–2 wired (read + approve/deny) | `BRIDGE_LIVE_PLAN.md` |
| Desktop app **dispatches + executes** an agent | B | **Wired** in `main/index.ts` — `DecisionBroker` + `gov:requestAction → AgentLoop → PEPs`; the June "not wired" note is superseded | `packages/desktop/app/src/main/index.ts` |
| App verified to **launch** post-wiring | B | ✅ **Verified 2026-07-13** — `npm run dev` opens the desktop app on Windows (M1 done) | Scott run |
| Chat-first "what do you need?" entry | B | ✅ **Done** — Calm Home's one-input landing surface (`Home.tsx`) calls `requestAction({kind:'mission', text})` directly; this is the plain free-text→governed-task surface | `packages/desktop/app/src/renderer/src/screens/Home.tsx` |
| Seeded sample / in-app "watch it get denied" | A/B | Exists only as the separate `examples/zero-change-demo` CLI artifact | `PERSONAS_AND_GAPS.md` |

**Reading (updated 2026-08-01):** the technical creator is ~one polish pass from a genuinely good Track-A
experience, and Track A's install gap (npm publish) is now closed. Track B's runtime is built **and**
connected to the app end-to-end — the remaining gap is a live verification run, not further wiring. See
`docs/design/M3_DISPATCH_VERIFICATION_PLAN.md`.

---

## 2. The milestone path

Milestones are ordered by dependency. Each lists **goal · work (owner) · exit criteria · what you can
create here · rough solo effort**. `[me]` = doable in-session; `[Scott]` = needs creds / machine / certs.

### M0 — Track A is publishable and self-starting  *(fastest path to "a technical user creating")*
**Goal:** a technical user who is not Scott can `npm i -g project-starfish`, govern a real Claude Code
project, and never think about the daemon.
**Work:**
- ✅ **(done 2026-08-01)** `[Scott]` Ran `npm run ci` on Windows, pushed, tagged, and published — `project-starfish@0.26.0` is live on npm (v0.24.0/v0.25.0 also published in the same pass, catching the registry up from the stale v0.11.1).
- ✅ **(done 2026-07-13)** `[me]` Daemon auto-start: the hook starts the daemon fail-closed if it's down (no allow-window), so "I forgot to run `starfish daemon`" stops being a deny-all footgun.
- ✅ **(done 2026-07-13)** `[me]` `starfish audit` reader with `--json` / `--since seq` / `--verify` for scriptable inspection (Priya gap #4).
- `[me/Scott]` Capture one full governed Claude Code task start-to-finish + its audit log as the proof artifact (never yet done end-to-end).
**Exit:** fresh machine → `npm i -g` → `starfish init --overlay` → `install --claude-code` → build with CC → audited, no manual daemon babysitting; audit is scriptable.
**Create here:** *anything you'd build in Claude Code today — now deny-by-default and audited.*
**Effort:** `[me]` ~3–5 days; `[Scott]` publish + one CI run.

### M1 — The app boots and shows the real governor  ★ start of Track B
**Goal:** GCS Starfish launches post-wiring and shows live governor state, not `DEV.*` mocks.
**Work:** `[me]` `cd packages/desktop/app && npm run dev`; fix boot / IPC / onboarding runtime errors (never run since the live wiring). Then `BRIDGE_LIVE_PLAN` **Phase 1** — swap `DEV.*` read handlers for real projections (crew, decisions, audit, budgets, monitor); add `projections.ts` + a conformance test.
**Exit:** app launches clean; the Bridge shows a real running governor's audit/budgets/crew.
**Create here:** nothing yet — you can *observe* real governance, not drive it.
**Effort:** ~1 week (2–5 days of that is just proving it launches).

### M2 — Human-in-the-loop control is live
**Goal:** operator Approve / Deny / Resume actually move a (soon-to-exist) agent.
**Work:** `[me]` `BRIDGE_LIVE_PLAN` **Phase 2** — `DecisionBroker` in `governance-core`: a PDP `ask`
records a pending decision and returns an awaitable; the loop awaits it; `requestAction{approve|deny}`
resolves it (operator ≠ proposer enforced); persist pending decisions fail-closed.
**Exit:** a pending decision can be resolved from the Bridge and is audited.
**Create here:** still nothing runs — but the control seam creation depends on is in place.
**Effort:** ~3–5 days.

### M3 — Dispatch: talk to it and it runs  ★★ THE milestone for this audience
**Goal:** type a brief in the app → a governed agent actually runs it with a real model call.
**Status correction (2026-08-01):** the "Work" below describes this as still to build (`Replace void
buildRuntime`). That's stale — `buildRuntime()` is called and used (`main/index.ts`'s `runAgent()`), not
void-ed. `requestAction{kind:'mission'|'order', text}` already creates a governed `Task` and runs
`AgentLoop.run` with `Dispatcher` + `HostRunner`, wired all the way from `Home.tsx`'s brief box. The
`STARFISH_ALLOW_EGRESS` gate only applies to router-kind providers (OpenRouter) — the default Anthropic
provider doesn't need it. This milestone is built; what remains is a live verified run, not
construction — see `docs/design/M3_DISPATCH_VERIFICATION_PLAN.md` for the concrete next step.
**Exit:** an order typed in-app runs a real governed agent to completion, gated + audited.
**Create here:** *this is where a technical user starts creating with Starfish itself* — give it a brief,
it plans and runs under governance. (Output may still be "reasoning + proposals" until M4 gives it real
tools.)
**Effort:** superseded — this is now a verification task (hours, not weeks); see the plan doc above.

### M4 — Real tools / self-hosting (create actual artifacts)  ★★
**Goal:** the agent produces real files/code, every tool call gated + evidence-checked.
**Status correction (2026-08-01):** also built, not open work. `packages/desktop/src/peps.ts`'s
`makeExecutor` implements every `ToolExecutor` below for real — `fs.read`/`fs.list` visibility-scoped,
`fs.write` worktree-scoped with a pre-image backup on every overwrite, `run_tests`/`git_commit` routed
through the T-05-hardened command templates. Not stubs. **Dogfood target** (from `BRIDGE_LIVE_PLAN`):
"add `lastActiveTs` to `AgentDetailView`, update the conformance fake bridge, run the desktop tests" —
this doubles as the M3 verification run, since M3's dispatch path already calls this same executor.
**Exit:** an agent makes a real, governed code change to a repo, gated by the operator, backed by evidence.
**Create here:** *real artifacts — code, documents, edited files — governed end to end.* The Track-B
Definition-of-Done item 3(B) is met.
**Effort:** superseded — rides M3's verification run; see `docs/design/M3_DISPATCH_VERIFICATION_PLAN.md`.

### M5 — Creator ergonomics (make it pleasant + legible, not archaeology)
**Goal:** a technical creator reaches first governed creation without reading source, and governance is
*legible* rather than a nag.
**Work (`[me]`, informed by `PERSONAS_AND_GAPS.md` Priya gaps):**
- **Chat-first entry** — elevate COMM to a plain "What do you need?" box that maps free text → governed Task.
- **Discoverability** — a Skill Library + an agent-capability view ("what tools can this agent touch, what's the boundary?").
- **In-app "watch it get denied"** — wire `examples/zero-change-demo` to a one-click "try an attack" that shows the deny live in the Bridge (Priya's wow moment).
- **Seeded first task** — something to press "run" on immediately.
- **Legible approvals** — risk descriptor (Clear→Forbidden) + floor flags on the approval card; routine safe work stays quiet under Risk-Tolerance defaults (RM-5, largely shipped v0.23).
- **Output delivery** — artifacts land in an obvious folder with a "reveal file" action.
**Exit:** a new technical user (not Scott) reaches first governed creation in < 15 min, no source-reading.
**Create here:** everything from M3/M4, now discoverable and quiet-until-it-matters.
**Effort:** ~1–1.5 weeks (some already done via RM-5).

### M6 — Packaged + distributable
**Goal:** a technical user installs the *app* from a signed build and creates without a clone or dev server.
**Work:** `[Scott]` signing certificates; `[me]` electron-builder signed installer + double-click launcher;
`[me]` `starfish init` can open the installed app; daemon auto-start carried from M0.
**Exit:** install a signed GCS Starfish build → create, no clone.
**Create here:** the whole Track-B experience, distributable to other technical users.
**Effort:** `[me]` ~3–5 days once `[Scott]` certs exist.

---

## 3. Critical path & parallelism

```
Track A (ship the working thing):   M0 ─────────────────────────▶ (a technical user is creating TODAY-ish)
                                     │ (publish + daemon auto-start + scriptable audit)
                                     │  independent of Track B — can ship first
Track B (the talk-to-it product):   M1 ─▶ M2 ─▶ M3 ─▶ M4 ─▶ (creating inside Starfish)
                                                    └──▶ M5 (ergonomics, rides on M3/M4)
                                                              └──▶ M6 (needs Scott: certs)
```

- **Shortest line to "a technical user is creating":** finish **M0**. That alone satisfies the Definition
  of Done via Track A (govern a real Claude Code session, scriptable audit, deny-on-purpose demo).
- **Shortest line to the differentiated "create inside Starfish":** **M1 → M3 → M4** (M2 is a prerequisite
  inside that line). ~4–6 weeks solo at your test-first rigor.
- **M5** can overlap M3/M4 for anything not depending on a live run (chat entry scaffold, skill library,
  approval copy). **M6** is gated only by Scott's certs.

---

## 4. The technical creator's first session (concrete)

**Today (Track A, works now — from GitHub until M0 publishes v0.23):**
```bash
npm install -g github:Azerax/Starfish        # or npm i -g project-starfish (v0.11.1 until M0)
cd <your project>
starfish init --overlay --writes auto --backups 2   # governance seeded; in-boundary writes quiet + recoverable
starfish install --claude-code                       # wire hooks + status line
starfish daemon                                      # resident PDP (auto-started after M0)
# build with Claude Code as normal — every tool call adjudicated + audited
starfish audit --json                                # (after M0) read the decisions
starfish doctor                                      # confirm the lockdown
```
Status line shows `⬡ Starfish ✓ governed · 42✓ 3⛔ · daemon up`. You are creating under governance now.

**After M3–M4 (Track B, the product):**
```
open GCS Starfish  →  "What do you need?"  →  type a brief
   → governed Task created → agent plans → each tool call hits the PDP
   → you Approve the one write that matters → agent edits files, runs tests (evidence-gated)
   → artifact appears in the output folder → audit shows the whole chain
```

---

## 5. Out of scope for this doc (pointers, not re-planning)
- **Non-technical (Marcus) parity** — the API-key wall (managed key), plain-language everything, zero-jargon
  onboarding: `MASTER_COMPLETION_PLAN.md` Phase 2, `LAUNCH_READINESS_PLAN.md` §4.
- **The 10 launch skills** — `LAUNCH_READINESS_PLAN.md` §3, `MASTER_COMPLETION_PLAN.md` Phase 3. (A technical
  creator can `starfish govern` their own packs meanwhile, so the empty-harness gap bites them less.)
- **Messaging connectors / voice / mobile** — OpenClaw *breadth*; deferred (`FEATURE_CANDIDATES.md`, master plan Phase 4).
- **GTM, comparison pages, screenshots, legal, external security review** — master plan Phases 5–6.

---

## 6. Open decisions / Needs Scott
- **Which "creating" is the target for the near term** — Track A (govern my building; nearly done) or
  Track B (build inside Starfish; ~a sprint)? This roadmap advances both but the answer sets M0-first vs
  M1-first.
- **Publish the v0.23 line** (push/tag/`npm publish` + provenance/SBOM) — gates M0 and every "install from
  npm" step.
- **Signing certificates** — gate M6.
- **`STARFISH_ALLOW_EGRESS` default in-app** — a real model call in M3 needs egress; confirm the default
  posture (off, opt-in per session, recommended).

---

## 7. Honest uncertainties
- I did not run `npm run dev` or the vitest suite from here; "dispatch not wired / 300+ tests green / `out/`
  stale" are taken from your assessment docs and the `void buildRuntime` note, not a live run. Running the
  desktop package would harden M1's "days" estimate into a real number — say the word and I'll do it.
- Effort ranges assume solo work and your existing convention that each new seam ships a conformance test.
- The npm-published version (v0.11.1 vs the v0.23 local line) is from `MASTER_COMPLETION_PLAN.md` + memory;
  confirm against `npm view project-starfish version` before quoting it publicly.
