# Project Starfish - Code Audit (2026-07-03)

Scope: the full monorepo, with emphasis on the trusted computing base (`governance-core`), the new
Starfish External embedding stack (`sdk`, `serve`/sidecar, `ui`), the Claude Code hook seam
(`governance-hooks`), the desktop host (`desktop`), and repo hygiene. Method: three parallel read-only
audits, then every High/Critical claim was spot-verified against the source (file:line) before being
recorded here. `[verified]` marks claims re-checked directly. Nothing was changed; this is analysis.

## Overall posture
Strong. The PDP is a genuine single choke point; deny-by-default is structurally real (unknown tool ->
deny; unmatched write/exec policy -> ask, never allow; critical -> ask; injection tier -> hard deny) and
fail-closed is consistently wired (audit-write failure -> deny, evaluator error -> deny, safe mode ->
deny, boundary-derivation failure -> deny, transport error -> deny). All three auditors independently
confirmed no fail-OPEN path on the main decision route. The findings below are mostly defense-in-depth
and hardening gaps, plus one operational secret to rotate - not open barn doors.

## Critical

- **A1. Boundary containment is case- and Unicode-exact; a real bypass on Windows/macOS.** `[verified]`
  `governance-core/boundary.ts:44,48` - `containCheck` matches roots and denied subtrees with
  case-sensitive `===`/`startsWith`. On case-insensitive filesystems (this project runs on Windows), an
  agent can evade both the write boundary and, worse, the `.starfish`/audit **denied-subtree** guard by
  varying case (`.STARFISH`) or 8.3 short names. `realpathSync` resolves symlinks but does not normalize
  case. Affects: boundary containment + governance-state protection.
  Fix: platform-aware case-fold (lowercase both sides on win32/darwin) + NFC-normalize before compare;
  add Windows-path conformance tests (current boundary tests are POSIX-only).

- **A2. Live API key on disk in `.env`.** `[verified: not tracked, gitignored, 0 in git history]`
  A real-looking credential sits in the working-tree `.env`. It was never committed or pushed, but it has
  been exposed to local tooling/sessions. Fix: rotate/revoke the key now; keep only `.env.example`;
  confirm no backup captured it. (Value intentionally not reproduced here.)

## High

- **A3. Egress secret-containment scans only `call.input.result`.** `[verified]`
  `governance-core/pdp.ts:131` - `egress()` reads only `result`. The shipped agent loop passes that key
  (covered), but the PDP is the advertised single choke point; any other caller passing output under a
  different key (`content`/`body`/`text`) gets `egress-clear` with **zero scanning** -> fail-open leak.
  Fix: scan every string field of `call.input`, or deny when the expected field is absent.

- **A4. Secret-file write content screened only when an `input.content` string is present.** `[verified]`
  `governance-core/pdp.ts:107` - `.env`/secret-path writes are poison-screened only if `content` is a
  string; a write whose payload lives under another key passes the gatekeeper unscreened. Also the
  ring-3 executor (`desktop/peps.ts`, `sdk/executor.ts`) re-checks the boundary but NOT `isSecretPath`/
  `screenEnv`, so it trusts the PDP entirely for secrets. Fix: deny secret-path writes with no screenable
  content (fail-closed); mirror the secret check in the executor.

- **A5. Policy `resource` (and audit `target`) derived from the first string in `input`.** `[verified]`
  `governance-core/pdp.ts:117,136` - `firstPath` returns the first string value by object-key order, not
  the declared path param. Boundary checks correctly use `tool.pathParams`, but a path-scoped policy can
  be mis-applied/bypassed and the audit `target` can log the wrong field. Fix: derive resource/target
  from `tool.pathParams`.

- **A6. Sidecar `/v1/decisions` trusts client `refId`/`riskTier`/`reason`.** `[verified]`
  `sdk/serve.ts:52` - the file route spreads the whole client body and overrides only `actor`. `refId` is
  the broker dedup key (`broker.ts:35`) computed elsewhere as `${task.id}:${callHash(call)}`
  (`sdk/index.ts:73`), so a worker can pre-file a decision with a benign `riskTier`/`reason` under a
  refId the operator's real high-risk ask will reuse - downgrading what the operator sees before
  approving. Fix: build the pending record from a strict allowlist; validate `riskTier` against an enum;
  namespace/reject client `refId` for worker-filed decisions.

- **A7. Catastrophic-shell denylist has trivial bypasses.** `[verified: `rm -fr /` and long-form not matched]`
  `governance-hooks/handler.ts:27-37` - `\brm\s+-rf?\s+[~/]` misses `rm -fr /`, `rm -r -f /`,
  `rm --recursive --force /`, `chmod 777 <syspath>`, `curl ... | python|perl|node`, `find / -delete`,
  `rm -rf $HOME`. Mitigation: a miss falls through to `p-shell` = **ask** (not silent execution), but the
  list exists to stop an operator rubber-stamping an ask. Fix: match any flag order/long-form + broaden
  the pipe-to-interpreter set + `chmod 777` on system paths.

- **A8. `net` egress has no destination containment.** `[verified: net pathParams = []]`
  `overlay/seed.ts:21`, `governance-hooks/handler.ts:47` - WebFetch/WebSearch map to `net` with empty
  `pathParams`, so the PDP never containment-checks the URL; it is only risk-scored and gated by `ask`.
  Given exfiltration is in the threat model, an arbitrary-URL `net` call is the classic channel with only
  a human ask in front. Fix: treat `url` as a governed resource; deny RFC1918/loopback/`169.254.169.254`
  by default; support an operator allow-list.

- **A9. Undeclared cross-package deps (phantom deps).** `[verified]`
  `desktop/package.json`, `governance-hooks/package.json` declare no `dependencies` yet import
  `@starfish/*`; works only via workspace hoisting (`sdk` declares its deps correctly - inconsistent).
  Fix: declare the `@starfish/*` deps in every package.

## Medium

- **A10. TOCTOU between check and use.** `governance-core/boundary.ts` validates a canonical path, but the
  executors (`desktop/peps.ts`, `sdk/executor.ts:15,20,26`) re-derive and operate on the original string;
  a symlink swapped in between check and IO can escape. Fix: resolve once, open with `O_NOFOLLOW`-style
  semantics / re-check at open.
- **A11. No request-body size limit on the sidecar.** `sdk/serve.ts:14` - `readJson` buffers unbounded ->
  local OOM / denial-of-governance. Fix: cap (~256 KB), destroy socket + `413` on exceed; add timeouts.
- **A12. No `Host`-header check on the sidecar.** `sdk/serve.ts:34` - loopback is enforced by
  `remoteAddress` only; a browser page hitting `127.0.0.1:<port>` originates from loopback and passes.
  The bearer token is the only barrier (partial mitigation: the required custom `x-starfish-wire` header
  forces a CORS preflight for cross-origin). Fix: reject non-`localhost` `Host` headers.
- **A13. Token file perms best-effort; Windows unenforced; doctor only WARNs.** `overlay/starfish.mjs`
  runServe/runEmbedDoctor - `chmod 0o600` in a swallowed try/catch (no-op on Windows), and
  `doctor --embed` reports WARN not FAIL. Whoever reads `sidecar-tokens.json` gets both worker AND
  operator authority (defeats proposer!=approver). Fix: write with `{ mode: 0o600 }` at creation, set a
  Windows ACL, escalate the doctor check to FAIL.
- **A14. Provider substitution fails open to the active provider.** `governance-core/dispatch.ts:54` - a
  routed-but-unregistered provider silently falls back to the active one; a "high-risk -> provider X only"
  intent can be downgraded. Fix: fail closed for high/critical tiers.
- **A15. Token-usage parse failure -> 0 cost.** `governance-core/runner.ts:92` - unparseable/absent usage
  yields `usd:0`, so the TokenGovernor can be starved and never trip. Fix: conservative estimate or a
  call-count budget.
- **A16. Torn audit line throws uncaught on boot / kills the monitor.** `governance-core/audit.ts:18`
  (`recover`) and `monitor.ts` window/count `JSON.parse` every line without try/catch; a truncated final
  line becomes an unhandled `SyntaxError` (bricks boot rather than clean safe-mode). Fix: wrap per-line
  parse; on a bad tail, truncate + Critical audit event or enter safe mode deliberately.
- **A17. Default config has no audit anchoring; truncation undetected.** `governance-core/audit.ts:41`
  `verify()` passes on a truncated-but-consistent prefix; anchoring/self-integrity (which catch
  truncation) are OFF by default (`boot.ts:49-57`). Fix: persist a head anchor `{seq,hash}` by default;
  document that (4) is truncation-evident only when self-integrity is enabled.
- **A18. `run_tests` argument injection + mis-audited failures.** `desktop/peps.ts:66-71` - agent-supplied
  `args` are split into argv (no shell, but flag injection into the runner); failures are audited as
  `decision:'allow'`. Fix: allow-list args; audit failures distinctly.
- **A19. dep-direction-lint misses side-effect/dynamic/`require` imports and `.tsx`.**
  `scripts/dep-direction-lint.mjs:31,37` - only `import ... from '...'` in `.ts` is scanned; an upward dep
  via `import 'x'`, `await import('x')`, `require('x')`, or in a `.tsx` file passes silently. Fix: broaden
  the regex + include `.tsx`.

## Low (selected)
- **A20. proposer!=approver only blocks self-approval, not agent-vs-agent.** `broker.ts:59` accepts any
  `by !== d.actor`; any non-proposer agent id qualifies. Restrict `by` to an operator principal set.
- **A21. Broker decision id (`dec_<Date.now>_<n>`) not collision-safe across restarts** (`broker.ts:37`);
  prefer `randomUUID`.
- **A22. Shared global secret regexes** (`secrets.ts:35`) risk stale `lastIndex` under interleaving; build
  fresh instances or reset. Injection screens are heuristic denylists (document as best-effort; the
  monitor `reconcile` is the real backstop).
- **A23. `git_commit` runs `git add -A` + `--no-verify`** (`desktop/peps.ts:73-79`): stages everything
  (incl. files outside the write boundary) and skips repo hooks. Scope the add; reconsider `--no-verify`.
- **A24. Grep/Glob target lost** (`handler.ts:43` dead ternary -> always `.`): the real search path is
  never boundary-checked. Extract `path`/`glob`.
- **A25. Sidecar `resolved` map grows unbounded + lost on restart** (`serve.ts:29`): status returns
  `unknown` after restart. Bound/expire/persist.
- **A26. `doctor --embed` uses `allowCloudFs:true`** (`starfish.mjs`), so it won't surface a
  cloud-synced-root problem the server would refuse; and calls `verifyAudit()` twice.

## Strengths (verified, keep)
- PDP fail-closed discipline is real: deny defaults on every ingress branch; evaluator wrapped in
  try/catch -> deny; audit-write failure -> deny.
- Deny-by-default seed: only `fs.read` is blanket-allowed; write/exec/net have no allow policy -> ask.
- Self-integrity root-of-trust is correct (expected pubkey passed out-of-band, not read from the signed
  blob; rollback + audit-truncation anchors checked when enabled).
- Skill integrity: no-follow reads + total symlink rejection + triple-hash TOCTOU defense.
- Monitor `reconcile`: a compromised watcher claiming "all clear" while counters show events trips its
  own Critical alarm.
- Sidecar: constant-time token compare (`timingSafeEqual` + length pre-check); correct auth ordering
  (loopback -> wire -> token); server-assigned actor identity; `@starfish/ui` does NOT import the engine.
- Executors are shell-free (`execFileSync`, fixed argv); pre-image backups with retention; daemon bounds
  session memory (evict at 1000).

## Prioritized remediation
1. **A2** rotate the live `.env` key (operational, do now).
2. **A1** case/Unicode-fold boundary + denied-subtree matching; add Windows path tests.
3. **A6** lock the `/v1/decisions` body to an allowlist; reject client `refId` for worker-filed decisions.
4. **A3/A4** scan all egress fields; deny unscreenable secret-path writes; mirror secret checks in the executor.
5. **A7/A8** harden the catastrophic-shell denylist; add `net` destination containment (deny internal ranges).
6. **A5** derive policy resource/audit target from `pathParams`.
7. **A11/A12/A13** sidecar body cap + Host-header check + enforce/verify token-file perms (FAIL in doctor).
8. **A16/A17** make the audit robust to torn lines + a default head anchor.

## Notes
- No `TODO`/`FIXME` markers found. Test coverage is broad (362 tests) but blind on: Windows path
  semantics, egress/secret scanning under alternate field names, and the peps executor (symlink escape,
  secret paths, `run_tests` args, `git_commit`).
- Severities reflect the invariant at stake, but most items are partially mitigated (e.g. A7/A8 fall to
  `ask`, not silent execution) - see each finding.
