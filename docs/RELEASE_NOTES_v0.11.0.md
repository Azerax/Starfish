# Project Starfish v0.11.0

Focus of this release: make the **governed desktop app usable end to end**. Live agent dispatch
(COMM/PADD -> Task -> model -> PDP -> tools) now works against a real Anthropic key, the
approval loop is clear instead of silent, and a new **My Ready Room** surfaces the "total stop"
issues (like a missing API key) loudly instead of failing quietly. Plus two real bug fixes that
blocked any tool-using run.

## Fixed

- **Provider tool-name 400 (blocked every model call).** Governed tool names contain dots
  (`fs.read`, `fs.write`), which Anthropic/OpenAI/Google reject (`^[A-Za-z0-9_-]{1,64}$`). Because
  the tool list is sent on every request, even a plain text prompt returned HTTP 400. Tool names are
  now mapped on the wire (`fs.read` <-> `fs__read`) and restored when the model's tool calls are
  parsed back, so the PDP still sees the governed name. This is what stopped the haiku test from
  running.
- **Approve -> re-ask loop on file writes.** After an approved `fs.write`, the transcript flattened
  the agent's tool call to the literal text `[tool_use]`, so the model never saw its call
  acknowledged and re-issued it (re-triggering approval). Tool calls and results are now threaded
  clearly (`called fs.write(...)` / `result of fs.write: wrote notes.md (done)`), so the run
  completes instead of looping.
- **Relative paths denied as "outside boundary."** The agent didn't know the workspace root, so a
  path like `notes.md` resolved against the app's working directory and failed containment. The
  agent is now told the absolute workspace root and instructed to use absolute paths; the executor
  also creates parent directories before writing.
- **Console mojibake** (`ΓÇö`) from a UTF-8 em dash in a `console.log` on Windows terminals.
- **False "Watcher discrepancy" alarm.** The security monitor treated routine denials as
  "concerning" and flashed a red watcher-discrepancy ribbon. Deny-by-default *produces* denials by
  design; the ribbon now fires only on genuine anomalies (boundary escapes, hash mismatches,
  budget-hard pauses, orphan tool-results).

## Added

- **My Ready Room.** A dedicated view listing "total stop" issues that block real work (missing API
  key for the active provider, un-opted data-egress for router providers, worker hard-budget pause),
  each with a one-click resolve action. A **forced but dismissible popup** raises these in your face
  when they appear (Minimize / Dismiss), and re-raises automatically when a new one shows up. The
  Ready Room nav button **pulses red** with a count while anything is blocking you.
- **Cost governance modes.** Choose who enforces spend: **Platform-managed** (default; your provider
  console cap is the ceiling, Starfish sets no local budget) or **Starfish budget cap** (an optional
  local USD hard limit that pauses the worker). Starfish never raises your provider's own limit.
- **Remember last workspace.** The app persists the workspace it was initialized against and reopens
  it on launch, so there is a single source of truth for "which workspace am I" (no environment
  variable juggling in dev; one launch for the shipped app).
- **Clear approval UX in COMM.** An in-flight order now shows a "paused for your go/no-go" panel
  (the agent is not stuck) with Approve/Deny inline, in addition to the Bridge queue. Order results
  render in a readable block, and the stop-reason is always shown.

## Changed

- **Crew "risk" relabeled to "clearance."** Per-agent tiers are an authority/scrutiny level, not a
  threat rating; labeling your own crew "risky" read wrong. Now shown as `clearance: low|medium|high`
  with an explanatory tooltip.
- **Token Governor** shows **platform-managed** instead of a confusing `$0.00 / $0.00` when no local
  cap is set.
- **Website SEO.** New pages `/agentic-ai-security/` and `/what-is-ai-governance/` (with FAQ schema),
  an open-source-forward title/meta/H2 on the home page, cross-links, sitemap entries, and deferred
  web fonts.
- **`scripts/dev-fresh.ps1`** helper: launches the dev app against your real workspace; `-Reset` is
  opt-in and never touches your install by default.

## Notes

- Tests and the CLI bundle build on a linked environment / CI (this release was typechecked per
  package; the sandbox used for authoring cannot run esbuild or the test runner).
- The tool-result threading fix is text-level and reliable for capable models; native
  `tool_use`/`tool_result` block threading remains a future hardening for complex multi-tool runs.
