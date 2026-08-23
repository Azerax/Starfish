# Starfish.FoundryAdapter (.NET)

The .NET port of `../python-adapter` -- same wire protocol, same fail-closed rules, same deployment
assumption (this must run co-located with the Starfish sidecar container, reachable at `127.0.0.1`; see
`docs/design/azure.md` Sec 3 for why).

## Status: verified against both a stub AND a real containerized `governance-core` PDP

A `dotnet` SDK turned out to be installable in the sandbox this was built in after all (the earlier "not
compile-tested" status was written when it looked unavailable). Since then:

1. `dotnet build` failed on the first attempt -- the `.csproj`'s own header comment used a literal `--`
   inside an XML comment, which MSBuild's XML parser rejects. Fixed, then built clean (one unrelated,
   harmless `CS1998` warning about a sync executor callback in an async method).
2. `StarfishFoundryAdapter.Tests/Program.cs` -- a console harness mirroring `../run_tests.py`'s scenarios:
   benign allow, boundary-escape deny, self-approval rejection + resolution by a different actor,
   ask-then-resolve-then-resume, an ask that times out unresolved, an ask the operator genuinely denies, an
   exhausted-vs-ample run budget pair, and a filing-failure fail-closed check. **16/16 checks passing**
   against both `../server_stub.mjs` (a stub Governance) AND a real, containerized `governance-core` PDP
   (`docker run --network container:<sidecar>`, via `dotnet publish` + running the published DLL in a
   `dotnet/runtime` container joined to the sidecar's network namespace) -- see `IMPLEMENTATION_PLAN.md`
   Sec 6c/6j/6s/6v for the full account, including the real bugs this pass found and fixed: a
   boundary-fixture shape gap only visible against the real PDP (§6c), a status-handling gap in the
   ask-timeout path that mischaracterized a transient/unknown poll status as a plain timeout (§6j),
   `maxWait`'s "comfortably under Foundry's 10-minute window" claim not accounting for that window being
   total elapsed time since the Foundry run was CREATED, not per function call (§6s, re-verified against a
   real container), and an unhandled exception that could escape `HandleAsync` if filing the ask itself
   failed (§6v).
3. **The most consequential fix**: `ResolveDecisionAsync` now validates its `verdict` argument is exactly
   `"approve"` or `"deny"` before sending it. This project's own earlier test code called it with
   `"denied"` in five places -- `serve.ts`'s wire protocol silently treats ANY non-`"deny"` string as an
   approval, so every one of those calls had been silently approving instead of denying, undetected until
   a new test caught the mismatch. See `IMPLEMENTATION_PLAN.md` Sec 6k -- flagged there as the top-priority
   item in the manual checklist, since the real, complete fix belongs in shared `serve.ts` code.
4. **`HandleAsync` now accepts an optional `runCreatedAtUtc`** -- pass the Foundry run's own creation time
   and the adapter caps its ask-wait to what's genuinely left of Foundry's 10-minute budget instead of
   blindly to `maxWait`; see the usage sketch below and Sec 6s for the full reasoning. Omitting it keeps
   the older, riskier behavior for calls that aren't near the start of their run.
5. **`HandleAsync` no longer lets an unhandled exception escape if filing the ask itself fails** -- a
   transient `/v1/decisions` error after `DecideAsync` already returned `Ask=true` used to propagate as an
   unhandled exception, breaking this class's own documented "never throws for a governance denial"
   contract. Now fails closed with a governed refusal instead, matching every other sidecar failure mode in
   this adapter (Sec 6v).

To re-run against the stub: `bash run_tests.sh` (spawns `../server_stub.mjs`, wires up env vars, runs the
harness). To re-run against a real container, see `IMPLEMENTATION_PLAN.md` Sec 6c/6j for the exact
`docker run --network container:<sidecar>` invocation.

## Usage sketch

```csharp
var sidecar = new StarfishSidecarClient("http://127.0.0.1:8787", token);
var executor = new GovernedFoundryExecutor(
    sidecar,
    executors: new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
    {
        ["read_file"] = args => File.ReadAllText((string)args["path"]!),
    },
    boundary: new { visibility = new[] { "/data/governed-root" } },
    agentId: "my-foundry-agent");

// Inside your Foundry response loop, wherever you'd normally execute a function_call item directly:
var output = await executor.HandleAsync(
    new FoundryFunctionCall(callId, name, arguments),
    runCreatedAtUtc: run.CreatedAt);   // STRONGLY RECOMMENDED -- see the Status section above; omit only
                                        // if the Foundry run isn't in scope here
// output is a {type, call_id, output} dictionary ready to submit back to Foundry as function_call_output.
```
