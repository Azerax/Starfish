// This is the actual integration surface a Foundry customer's .NET app code uses: swap-in replacement
// for the raw "execute the function yourself" step in the function-calling loop (docs/design/azure.md
// Sec 3 diagram). Ported 1:1 from python-adapter/starfish_foundry_adapter/__init__.py's
// GovernedFoundryExecutor -- including, until tonight, a bug the Python original also had (see the
// HandleAsync ask-path comment below): a transient/unknown poll status got mischaracterized as a plain
// timeout. Fixed in both languages the same session it was found (IMPLEMENTATION_PLAN.md Sec 6j).

using System.Text.Json;

namespace Starfish.FoundryAdapter;

/// <summary>
/// Constants mirroring python-adapter/starfish_foundry_adapter/__init__.py's identically-named module
/// constants -- see that file's own comment for the Microsoft docs citation (checked 2026-08-03): Foundry
/// runs expire 10 minutes after creation, and that budget is total elapsed time since RUN CREATION, not
/// per function call. Found on review (IMPLEMENTATION_PLAN.md Sec 6s) that a fixed maxWait alone can't
/// know how much of that budget is already spent by the time a mid-run tool call needs approval -- see
/// HandleAsync's runCreatedAtUtc parameter below.
/// </summary>
internal static class FoundryRunBudget
{
    public static readonly TimeSpan RunExpiry = TimeSpan.FromSeconds(600);
    public static readonly TimeSpan SafetyMargin = TimeSpan.FromSeconds(30);
}

/// <summary>
/// Shape returned by Foundry's response API for a function-call item (see Learn: function calling). Only
/// the fields the adapter needs are modeled here.
/// </summary>
public sealed record FoundryFunctionCall(string CallId, string Name, IReadOnlyDictionary<string, object?> Arguments);

/// <summary>
/// One instance per governed agent/root. executors: tool name -> the REAL function logic; this class does
/// not know or care what the functions do, only whether they're allowed to run.
/// </summary>
public sealed class GovernedFoundryExecutor
{
    private readonly StarfishSidecarClient _sidecar;
    private readonly IReadOnlyDictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>> _executors;
    private readonly object _boundary; // BoundarySet shape from governance-core/boundary.ts, kept opaque here
    private readonly string _agentId;
    private readonly TimeSpan _pollInterval;
    private readonly TimeSpan _maxWait;

    /// <param name="agentId">The proposer identity recorded on every call -- must never equal the approver
    /// identity used to resolve an 'ask' (proposer != approver is enforced server-side, but keep this
    /// straight in your own code too).</param>
    /// <param name="maxWait">The CEILING on how long to wait on an 'ask' before giving up -- NOT, on its
    /// own, a guarantee of staying under Foundry's 10-minute run-expiry window (Learn: function calling).
    /// That guarantee only holds if the wait starts near the beginning of the run's lifetime; Foundry's
    /// 10-minute budget is total elapsed time since RUN CREATION, not per function call. Pass
    /// runCreatedAtUtc to HandleAsync (see its own doc comment) so the ACTUAL wait gets capped to what's
    /// genuinely left of the run's real budget, not blindly to this value. Defaults to 480s, matching the
    /// Python adapter.</param>
    public GovernedFoundryExecutor(
        StarfishSidecarClient sidecar,
        IReadOnlyDictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>> executors,
        object boundary,
        string agentId = "foundry-agent",
        TimeSpan? pollInterval = null,
        TimeSpan? maxWait = null)
    {
        _sidecar = sidecar;
        _executors = executors;
        _boundary = boundary;
        _agentId = agentId;
        _pollInterval = pollInterval ?? TimeSpan.FromSeconds(1);
        _maxWait = maxWait ?? TimeSpan.FromSeconds(480); // a ceiling, not a guarantee on its own -- see this parameter's doc comment
    }

    /// <summary>
    /// Returns a Foundry function_call_output item shape ({type, call_id, output}). Never throws for a
    /// governance denial -- a denial is a normal, auditable outcome, not an application error.
    /// </summary>
    /// <param name="runCreatedAtUtc">When the FOUNDRY RUN this call belongs to was created (UTC) -- NOT
    /// when this particular function_call arrived. When provided, the actual wait on an 'ask' is capped to
    /// whatever's genuinely left of Foundry's 10-minute run-expiry budget (minus
    /// FoundryRunBudget.SafetyMargin), never more than the configured maxWait either way. When omitted (the
    /// only behavior before this was added), maxWait is used as-is, which is exactly the gap this parameter
    /// exists to close for any call that isn't near the start of its run -- see the constructor's maxWait
    /// doc comment and FoundryRunBudget's own comment for why "comfortably under 10 minutes" isn't a
    /// guarantee a fixed TimeSpan can make on its own.</param>
    public async Task<Dictionary<string, object?>> HandleAsync(FoundryFunctionCall fc, DateTime? runCreatedAtUtc = null, CancellationToken ct = default)
    {
        var call = new { agentId = _agentId, tool = fc.Name, input = fc.Arguments };
        var decision = await _sidecar.DecideAsync(call, _boundary, ct).ConfigureAwait(false);

        if (decision.Ask)
        {
            var effectiveMaxWait = _maxWait;
            if (runCreatedAtUtc is { } createdAt)
            {
                var elapsed = DateTime.UtcNow - createdAt;
                var remainingBudget = FoundryRunBudget.RunExpiry - elapsed - FoundryRunBudget.SafetyMargin;
                effectiveMaxWait = remainingBudget < TimeSpan.Zero ? TimeSpan.Zero
                    : remainingBudget < _maxWait ? remainingBudget : _maxWait;
            }

            var path = fc.Arguments.TryGetValue("path", out var p) && p is not null ? p.ToString()! : fc.Name;
            string decisionId;
            try
            {
                decisionId = await _sidecar.FileDecisionAsync(_agentId, fc.Name, path!, decision.Reason, ct: ct).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                // Found on review: FileDecisionAsync throws InvalidOperationException on a non-200
                // response, and nothing here caught it -- meaning a transient failure filing the decision
                // (the sidecar was reachable enough for DecideAsync to return Ask, but /v1/decisions
                // itself errored) would propagate as an unhandled exception out of HandleAsync, breaking
                // this class's OWN documented contract ("Never throws for a governance denial -- a denial
                // is a normal, auditable outcome, not an application error"). Fail-closed here too,
                // matching every other sidecar failure mode in this adapter, rather than letting this one
                // path be the exception to fail-closed.
                return Refusal(fc, $"fail-closed: could not file the ask for operator review ({e.Message})");
            }

            if (effectiveMaxWait <= TimeSpan.Zero)
            {
                // The run's own budget is already exhausted (or within the safety margin) before this
                // adapter even started waiting -- polling at all would be pointless, since Foundry will
                // reject the eventual function_call_output as expired regardless of what verdict lands.
                // Fails closed immediately with a distinct, honest reason instead of looping zero times
                // and reporting a slightly misleading "still pending after 0s". The decision is filed
                // either way (above), so an operator can still see and reason about what was asked.
                return Refusal(fc, $"no time left to wait for approval: this Foundry run is already past its safe budget under the {FoundryRunBudget.RunExpiry.TotalSeconds:F0}s run-expiry window (decision {decisionId} filed for operator visibility regardless)");
            }

            var deadline = DateTime.UtcNow + effectiveMaxWait;
            var status = "pending";
            var timedOut = true;
            while (DateTime.UtcNow < deadline)
            {
                status = await _sidecar.PollDecisionAsync(decisionId, ct).ConfigureAwait(false);
                if (status != "pending") { timedOut = false; break; }
                await Task.Delay(_pollInterval, ct).ConfigureAwait(false);
            }

            if (status == "approved") return await ExecuteAsync(fc).ConfigureAwait(false);
            if (status == "denied") return Refusal(fc, $"operator denied: {decision.Reason}");
            if (!timedOut)
            {
                // Found tonight (same bug as the Python original, fixed there too -- see
                // IMPLEMENTATION_PLAN.md Sec 6j): PollDecisionAsync returns "unknown" on any transport
                // error or non-200 response, not just for a genuinely undetermined decision. The OLD
                // code here fell through to the timeout message unconditionally whenever the loop
                // exited for ANY non-pending reason, which would falsely claim "still pending after
                // {maxWait}s" even when the loop broke on the very first poll because of an actual
                // error -- misleading for anyone debugging why a call was denied. Now its own distinct
                // outcome instead of being folded into "timed out."
                return Refusal(fc, $"approval status could not be determined (decision {decisionId}): sidecar returned status={status}");
            }
            // Still pending when we stopped waiting -- a distinct outcome, not a silent deny.
            return Refusal(fc, $"approval still pending after {effectiveMaxWait.TotalSeconds}s (decision {decisionId})");
        }

        if (!decision.Allow) return Refusal(fc, decision.Reason);

        return await ExecuteAsync(fc).ConfigureAwait(false);
    }

    private async Task<Dictionary<string, object?>> ExecuteAsync(FoundryFunctionCall fc)
    {
        if (!_executors.TryGetValue(fc.Name, out var fn))
            return Refusal(fc, $"no executor registered for tool '{fc.Name}'");

        object? result;
        try
        {
            // Executors are synchronous Func<> here to mirror the Python adapter's shape exactly; a caller
            // needing async execution should wrap it (e.g. block on a Task inside the Func, or extend this
            // class with an async executor map) -- not solved here to keep the port 1:1 with what was
            // actually tested tonight (the Python side), rather than inventing a richer .NET-only API.
            result = fn(fc.Arguments);
        }
        catch (Exception e)
        {
            // Deliberately broad: any execution error becomes a governed, auditable refusal rather than an
            // unhandled exception bubbling into the agent loop.
            return Refusal(fc, $"execution error: {e.Message}");
        }

        return new Dictionary<string, object?>
        {
            ["type"] = "function_call_output",
            ["call_id"] = fc.CallId,
            ["output"] = JsonSerializer.Serialize(result),
        };
    }

    private static Dictionary<string, object?> Refusal(FoundryFunctionCall fc, string reason) => new()
    {
        ["type"] = "function_call_output",
        ["call_id"] = fc.CallId,
        ["output"] = JsonSerializer.Serialize(new { error = "denied_by_governance", reason }),
    };
}
