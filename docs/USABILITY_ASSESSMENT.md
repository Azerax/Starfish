# Critical usability assessment: can Starfish actually be used?

Evidence-based, as of 2026-06-21. Two modes, very different maturity.

| Mode | Can you use it today? | For what |
|------|----------------------|----------|
| **Claude CLI (overlay)** | **YES** | Governing a real Claude Code workflow: every tool call deny-by-default, contained, audited. |
| **Desktop UI (GCS Starfish)** | **NO (not for building)** | At best an observe + approve/deny/resume console; it cannot run agents, and runtime launch is unverified. |

The architectural reason for the gap: in **CLI mode Starfish only has to DECIDE** (Claude Code executes the
tools), and that decision layer is complete and verified. In **UI mode Starfish must also BE the runtime**
(dispatch + execute), and that half is not wired.

---

## Mode 1 - Claude CLI overlay: USABLE (operator mode)

### What works (verified)
- `starfish init --overlay` / `install --claude-code` / `daemon` / `doctor` / `attest` all built and bundled.
- Live deny-by-default proven end-to-end against the daemon and **R0-verified on real Claude Code 2.1.183**:
  deny actually blocks; it beats a co-existing allow-hook; `permissions.allow` does not skip it;
  `--dangerously-skip-permissions` does not skip it; managed env reaches hooks.
- Native CC tools (Read/Edit/Write/Bash/WebFetch) map to the governed model; catastrophic shell denied;
  unknown tools default-deny; audit log written.
- Hardening done: absolute hook paths, env scrub, governed-projects registry, config-drift safe-mode,
  integrity baseline + verify-before-exec launcher; `starfish doctor` audits all of it.

### What is rough / missing for "comfortable daily use"
1. **Approval friction - ADDRESSED.** A per-project/session `writes` profile lets the user choose: `auto`
   (in-boundary writes auto-allowed, with versioned pre-image backups in `.starfish/backups/`) or `ask`
   (prompt every write). The system-risk floor (out-of-boundary, secrets, `.starfish`, shell, catastrophic,
   delete hard-rules) is never lowerable. So a blog can run prompt-free-but-recoverable; critical work can
   stay strict. `Bash` remains gated in all profiles (arbitrary code = system risk).
2. **Daemon lifecycle.** The daemon must be running for the governed project, or every call fail-closed
   denies (correct, but you must remember to start it; nothing auto-starts it yet).
3. **Tamper-resistance needs admin.** Without the managed lockdown (Step 4), the operator/agent can switch
   hooks off (`disableAllHooks`); R0 confirmed this. Managed install fixes it but needs `sudo` and is not
   yet verified live by you.
4. **Not yet validated in a full live session.** R0 proved the hook *contract*; an actual "complete a real
   coding task, fully governed" run has not been done.
5. **Not published.** 0.10.0 is staged, not on npm yet (installable from source/GitHub today).

### Steps to "comfortable + trusted"
- [ ] Add an operator policy option to **allow `fs.write` within the project boundary** (less friction) while
      keeping shell/network/delete gated. (One policy entry; or a `starfish init --overlay --low-friction` flag.)
- [ ] Optional: have the hook **auto-start the daemon** if down (only in fail-closed mode, no allow window).
- [ ] Run `sudo starfish install --claude-code --managed` + `starfish doctor` (Step 4) and re-run R0 Step 4.
- [ ] Do one real governed task in Claude Code start to finish; capture the audit log.
- [ ] Publish 0.10.0 (`release.ps1`).

Verdict: **8/10.** Usable now for you as operator; the friction + daemon-start ergonomics and the
unpublished/admin-pending items are what stand between "works" and "pleasant + tamper-proof."

---

## Mode 2 - Desktop UI (GCS Starfish): NOT usable for building

### What works (verified this session)
- The app **now typechecks clean** (main + preload + renderer) - it did not an hour ago (implicit-any
  regressions + a daemon strictness bug were just fixed; tsconfig path mapping added).
- The **Bridge reads the live Governor** (crew, decisions, budgets, monitor, agent detail) and the
  operator can **approve / deny / resume** real pending decisions (Phases 1-2).
- Onboarding wizard exists (base-root picker, provider key into the OS keychain, governed default-skills intake).

### What is missing (the blocker)
1. **No agent dispatch.** `requestAction` for COMM orders / PADD skill-runs returns
   *"not yet wired (requires Phase 3 dispatch)"*; `buildRuntime()` (dispatcher + runner) is constructed but
   never invoked (`void buildRuntime`). So you can issue an order in the UI and **nothing runs**.
2. **No execution layer (PEPs).** For the app to *do* work (not just decide), it needs real boundary-checked
   tool executors (fs.read/write/list, run_tests, git_commit). None are wired into a run loop.
3. **`ask` decisions are not awaited.** The DecisionBroker exists, but the (unbuilt) agent loop doesn't park
   `ask` on it, so operator approve/deny can't unblock a running agent.
4. **Runtime launch is UNVERIFIED.** The build output in `out/` is from **June 14**, before all of the live
   wiring. Typecheck passing != runs: the Electron boot path, governance fail-closed boot, IPC, and the
   base-root/onboarding flow have not been run since. "Does it even launch and render correctly" is unknown.
5. **No model loop / cost path exercised** (provider key + egress) from the app.

### Steps to make UI mode usable for building
- [ ] **Run it and fix runtime errors.** `cd packages/desktop/app && npm run dev`; fix whatever the boot /
      IPC / onboarding path throws. (Prerequisite to everything else - it has never been launched post-wiring.)
- [ ] **Phase 3 - dispatch.** Wire `requestAction {order|mission|invoke}` -> create a governed `Task` ->
      run `AgentLoop.run` via the existing `buildRuntime()` (dispatcher + runner), with a real model call
      (Anthropic key from keychain, egress enabled). Replace `void buildRuntime`.
- [ ] **DecisionBroker in the loop.** Make a PDP `ask` park on the broker and have the loop await the
      operator's Approve/Deny (the Bridge UI already exists).
- [ ] **Phase 4 - real PEPs.** Implement the boundary-checked `ToolExecutor` (fs/read/list/write,
      run_tests, git_commit) so the agent can actually act; reuse the deletion path already built.
- [ ] **Phase 5 - live push + safety surfacing** (optional): `gov:evt:*` on audit append; safe-mode banner;
      evidence-gate blocks shown.
- [ ] **Package + launch** (electron-builder) so `starfish init` can open the installed app.

Verdict: **3/10 for "build with it."** It is a governance *console* (observe + approve), and even that is
unproven at runtime since the last changes. The runtime spine (router/dispatch/runner/agentloop) is built
and tested in the core; it is simply **not connected to the app's order buttons or to real executors.**

---

## Bottom line
- **Use CLI/overlay mode now** - it is the real, verified product and the fastest path to building under
  full governance (Claude Code does the work; Starfish governs it). Address write-friction + run Step 4.
- **Do not rely on UI mode to build yet.** First prove it launches (`npm run dev`), then do Phase 3 + 4
  (dispatch + PEPs). The pieces exist; the wiring between the UI and the runtime/executors is the gap.
