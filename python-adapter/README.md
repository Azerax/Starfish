# starfish-foundry-adapter

Starfish governance adapter for Azure AI Foundry Agent Service custom function calling.

Foundry doesn't execute your custom functions itself -- it hands your app a `function_call`, and your
app is responsible for executing it and returning `function_call_output` (see
`docs/design/azure.md` Sec 1). This package is the swap-in for the "execute it yourself" step: every
proposed call is routed through the Starfish sidecar's existing wire protocol
(`packages/sdk/src/serve.ts`) before it runs.

## Status

Protocol-tested against both the real, unmodified `serve.ts` (via a stub Governance, `../run_tests.py`)
AND a real, containerized `governance-core` PDP (via `docker run --network container:<sidecar>`) --
**15/15** checks passing as of this session (up from 7/7 across the engagement: an ask that times out
unresolved, an ask the operator genuinely denies, a direct check of `poll_decision`'s "unknown" return, two
checks for `handle()`'s `run_created_at` parameter, and a check that a filing failure fails closed instead
of raising -- see below). The `run_created_at` behavior was ALSO independently re-verified against a real
container (4/4, exhausted-budget and ample-budget cases), not left stub-only. See `IMPLEMENTATION_PLAN.md`
Sec 6c/6h/6s/6v for the real-container runs.

Four real bugs found and fixed this session, none visible from re-reading the code in isolation:
`resolve_decision()` now validates its `verdict` argument is exactly `"approve"` or `"deny"` -- the
sidecar's wire protocol silently treats ANY other string as an approval (IMPLEMENTATION_PLAN.md Sec 6k,
the most consequential finding of the whole engagement); the ask-timeout path no longer mischaracterizes a
transient/unknown poll status as a plain timeout (Sec 6j); and `max_wait_seconds`'s "comfortably under
Foundry's 10-minute window" claim didn't account for that window being total elapsed time since the
Foundry RUN was created, not per function call -- `handle()` now accepts an optional `run_created_at`
(epoch seconds) so the actual wait gets capped to what's genuinely left of the run's real budget, not
blindly to a fixed ceiling (Sec 6s). **Pass `run_created_at` when you have it** (Foundry's run object
exposes `created_at`) -- omitting it keeps the old, riskier behavior for calls that aren't near the start
of their run. And: `handle()` no longer lets an unhandled exception escape if filing the ask itself fails
(a transient `/v1/decisions` error after `decide()` already returned `ask=true`) -- it now fails closed
with a governed refusal instead, matching this class's own documented "never raises for a governance
denial" contract, which that one path had been silently violating (Sec 6v).

**Not yet tested against a real Foundry agent** -- that needs an actual Azure AI Foundry resource + agent,
which is Scott's manual setup step (see the implementation plan's checklist, item 1).

## Deployment assumption

The sidecar binds loopback-only (`127.0.0.1`) by design -- this adapter and the sidecar container MUST
run in the same pod / Container Apps revision. See `azure/bicep/sidecar-container-app.bicep` for the
reference deployment shape.

## Use

```python
from starfish_foundry_adapter import GovernedFoundryExecutor, StarfishSidecarClient, FoundryFunctionCall

sidecar = StarfishSidecarClient(base_url="http://127.0.0.1:8787", token=os.environ["STARFISH_WORKER_TOKEN"])

executor = GovernedFoundryExecutor(
    sidecar=sidecar,
    executors={
        "get_customer_record": get_customer_record,   # your real function, unchanged
        "send_invoice": send_invoice,
    },
    boundary={"visibility": ["/app/data"], "write": ["/app/data"]},
    agent_id="invoice-agent",
)

# In your existing Foundry response-handling loop, wherever you currently execute a function_call
# yourself, call this instead:
for item in response.output:
    if item.type == "function_call":
        fc = FoundryFunctionCall(call_id=item.call_id, name=item.name, arguments=json.loads(item.arguments))
        output_item = executor.handle(
            fc,
            run_created_at=run.created_at,   # STRONGLY RECOMMENDED -- lets the ask-wait budget itself
        )                                     # against what's actually left of Foundry's 10-minute window
        input_list.append(output_item)         # (see the Status section above); omit only if `run` isn't
                                                # in scope here, at the cost of the older, riskier behavior
```

A denial is not a Python exception -- it's a normal `function_call_output` describing the refusal, so the
model sees it and can react (apologize, try something else, ask the user), the same way any other tool
result would flow back into the conversation.
