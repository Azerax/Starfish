// C# port of run_tests.py's 4 scenarios, run against the SAME server_stub.mjs used to verify the Python
// adapter tonight -- same stub Governance, same real serve.ts, same expected outcomes. Reads the sidecar
// URL and tokens from environment variables set by a wrapper script that spawns server_stub.mjs and
// parses its SIDECAR_READY line (mirroring what run_tests.py does for Python).
//
// This is the "first thing to do with a real dotnet toolchain" item the .NET adapter's own README called
// out as not yet done. Written and run tonight once a dotnet SDK turned out to be installable in this
// sandbox after all.
using Starfish.FoundryAdapter;

var url = Environment.GetEnvironmentVariable("STARFISH_URL") ?? throw new Exception("STARFISH_URL not set");
var workerToken = Environment.GetEnvironmentVariable("STARFISH_WORKER_TOKEN") ?? throw new Exception("STARFISH_WORKER_TOKEN not set");
var operatorToken = Environment.GetEnvironmentVariable("STARFISH_OPERATOR_TOKEN") ?? throw new Exception("STARFISH_OPERATOR_TOKEN not set");
var operator2Token = Environment.GetEnvironmentVariable("STARFISH_OPERATOR2_TOKEN") ?? throw new Exception("STARFISH_OPERATOR2_TOKEN not set");

var results = new List<(string Name, bool Ok, string Detail)>();
void Check(string name, bool ok, string detail) => results.Add((name, ok, detail));

var workerClient = new StarfishSidecarClient(url, workerToken);
var operatorClient = new StarfishSidecarClient(url, operatorToken);
var operator2Client = new StarfishSidecarClient(url, operator2Token);

// NOTE: must include "write", not just "visibility" -- found the hard way tonight. Against
// server_stub.mjs (a stub Governance) an incomplete boundary was silently fine, but the real
// governance-core PDP's containCheck() does `bs.write.map(...)` unconditionally for write-mode
// tool calls; a missing "write" key throws, gets swallowed by pdp.ts's outer try/catch, and comes
// back as the generic "evaluator-error (fail-closed)" instead of the expected ask. That meant
// test app #4's fs.write call was being denied outright (never asked) when this Program.cs was
// first run against a real containerized sidecar, and FindSinglePendingDecisionAsync correctly
// found zero pending decisions. run_tests.py's Python boundary already had both keys -- this was
// a real gap in the .NET test harness itself, only visible once tested against the real PDP
// rather than the stub. See IMPLEMENTATION_PLAN.md for the concurrent finding in governance-core.
object boundary = new { visibility = new[] { "/workspace" }, write = new[] { "/workspace" } };

// --- Test app #1: benign happy path (Tier 1 allow) ---
{
    var executor = new GovernedFoundryExecutor(
        workerClient,
        new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
        {
            ["fs.read"] = args => new { content = "hello from a governed read (dotnet)" },
        },
        boundary,
        agentId: "worker");
    var result = await executor.HandleAsync(new FoundryFunctionCall("call-1", "fs.read", new Dictionary<string, object?> { ["path"] = "/workspace/ok.txt" }));
    var output = result["output"]?.ToString() ?? "";
    Check("benign read is allowed and executes", output.Contains("hello from a governed read"), output);
}

// --- Test app #2: boundary-escape attempt (Tier 1 deny) ---
{
    var executor = new GovernedFoundryExecutor(
        workerClient,
        new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
        {
            ["fs.read"] = args => throw new Exception("SHOULD NEVER EXECUTE -- boundary escape must be denied before this runs"),
        },
        boundary,
        agentId: "worker");
    var result = await executor.HandleAsync(new FoundryFunctionCall("call-2", "fs.read", new Dictionary<string, object?> { ["path"] = "/etc/passwd" }));
    var output = result["output"]?.ToString() ?? "";
    Check("boundary escape is denied and NEVER executes", output.Contains("denied_by_governance"), output);
}

// --- Test app #3: self-approval attempt (proposer != approver) ---
{
    var decisionId = await workerClient.FileDecisionAsync("worker", "fs.write", "/workspace/risky.md", "test-filed decision", ct: default);
    var (selfOk, selfReason) = await workerClient.ResolveDecisionAsync(decisionId, "approve", workerClient);
    Check("self-approval is rejected server-side", !selfOk, selfReason);
    var (otherOk, otherReason) = await operatorClient.ResolveDecisionAsync(decisionId, "approve", operatorClient);
    Check("a DIFFERENT actor can resolve the same decision", otherOk, otherReason);
}

// --- Test app #4: ask path -- pause, then resume via a different actor ---
{
    var executorTask = Task.Run(async () =>
    {
        var executor = new GovernedFoundryExecutor(
            workerClient,
            new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
            {
                ["fs.write"] = args => new { written = true },
            },
            boundary,
            agentId: "worker",
            pollInterval: TimeSpan.FromMilliseconds(300),
            maxWait: TimeSpan.FromSeconds(15));
        return await executor.HandleAsync(new FoundryFunctionCall("call-4", "fs.write", new Dictionary<string, object?> { ["path"] = "/workspace/risky.md" }));
    });

    // Give the executor a moment to file the decision and start polling, same pacing as run_tests.py.
    await Task.Delay(500);

    // Resolve via operator2 -- a distinct identity from both the proposer (worker) and the one used in
    // test #3 (operator), same "no reused approver identity" discipline the Python test follows. We
    // don't get the decision id back from the executor (it files its own internally), so list pending
    // decisions the same way the Python adapter's test harness inspects /v1/pending directly.
    var pendingId = await FindSinglePendingDecisionAsync(url, operator2Token);
    var (resolveOk, resolveReason) = await operator2Client.ResolveDecisionAsync(pendingId, "approve", operator2Client);
    Check("a distinct operator can approve it", resolveOk, resolveReason);

    var finalResult = await executorTask;
    var output = finalResult["output"]?.ToString() ?? "";
    Check("approving the ask actually resumes the run (executes, doesn't stall)", output.Contains("\"written\":true"), output);
}

// --- Test app #5: ask path that times out unresolved -- added after a review found neither this
// harness nor run_tests.py's Python version ever exercised GovernedFoundryExecutor's "still pending when
// we gave up" branch before this pass; every prior ask-path test always got resolved before the wait
// expired. Nobody resolves this one on purpose. ---
{
    var executor = new GovernedFoundryExecutor(
        workerClient,
        new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
        {
            ["fs.write"] = args => throw new Exception("SHOULD NEVER EXECUTE -- an unresolved ask must time out, not fall through to execution"),
        },
        boundary,
        agentId: "worker",
        pollInterval: TimeSpan.FromMilliseconds(300),
        maxWait: TimeSpan.FromSeconds(2));
    var sw = System.Diagnostics.Stopwatch.StartNew();
    var result = await executor.HandleAsync(new FoundryFunctionCall("call-5", "fs.write", new Dictionary<string, object?> { ["path"] = "/workspace/risky2.md" }));
    sw.Stop();
    var output = result["output"]?.ToString() ?? "";
    Check(
        "an unresolved ask times out with a distinct reason, not a silent allow or a hang",
        output.Contains("denied_by_governance") && output.Contains("still pending") && sw.Elapsed < TimeSpan.FromSeconds(5),
        $"elapsed={sw.Elapsed.TotalSeconds:F1}s output={output}");

    // Clean up the decision this left behind, via a distinct operator, so it doesn't leak into any
    // later inspection of pending decisions -- same discipline as run_tests.py's own cleanup.
    try
    {
        var leftoverId = await FindSinglePendingDecisionAsync(url, operatorToken);
        await operatorClient.ResolveDecisionAsync(leftoverId, "deny", operatorClient);
    }
    catch { /* best-effort cleanup; not itself part of what this test is verifying */ }
}

// --- Test app #6: ask path where the OPERATOR DENIES -- a real gap found the same pass that found and
// fixed a real bug in HandleAsync's status handling (see GovernedFoundryExecutor.cs's comment on the
// timedOut fix): every earlier ask-path test here only ever exercised approve-or-timeout, never a real
// operator rejection flowing back through the executor. A "denied" status and the "unknown" case the
// bug was actually about take the IDENTICAL early-exit (non-"pending") branch inside HandleAsync -- a live
// operator denial is the honestly-reachable way to exercise that branch through a real server response
// (nothing here mocks PollDecisionAsync; StarfishSidecarClient is sealed with no injection seam, and
// adding one for a message-selection bug already fixed and reasoned through in code review was judged a
// bigger intervention than the bug warranted). ---
{
    var executorTask = Task.Run(async () =>
    {
        var executor = new GovernedFoundryExecutor(
            workerClient,
            new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
            {
                ["fs.write"] = args => throw new Exception("SHOULD NEVER EXECUTE -- an operator-denied ask must not run"),
            },
            boundary,
            agentId: "worker",
            pollInterval: TimeSpan.FromMilliseconds(300),
            maxWait: TimeSpan.FromSeconds(8));
        return await executor.HandleAsync(new FoundryFunctionCall("call-6", "fs.write", new Dictionary<string, object?> { ["path"] = "/workspace/risky3.md" }));
    });

    await Task.Delay(500);
    var pendingId6 = await FindSinglePendingDecisionAsync(url, operatorToken);
    var (denyOk, denyReason) = await operatorClient.ResolveDecisionAsync(pendingId6, "deny", operatorClient);
    Check("a distinct operator can deny the ask", denyOk, denyReason);

    var result6 = await executorTask;
    var output6 = result6["output"]?.ToString() ?? "";
    Check(
        "an operator-denied ask returns 'operator denied', not the timeout message, and never executes",
        output6.Contains("denied_by_governance") && output6.Contains("operator denied") && !output6.Contains("still pending"),
        output6);
}

// --- Test app #7: runCreatedAtUtc whose budget is already exhausted -- refuses immediately, no polling
// wait at all. Mirrors run_tests.py's Test app #7 (a gap found on review: maxWait alone can't know how
// much of Foundry's 10-minute run budget is already spent by the time a mid-run call needs approval --
// see IMPLEMENTATION_PLAN.md Sec 6s and GovernedFoundryExecutor.cs's FoundryRunBudget comment). ---
{
    var exhaustedExecutor = new GovernedFoundryExecutor(
        workerClient,
        new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
        {
            ["fs.write"] = args => throw new Exception("SHOULD NEVER EXECUTE -- an exhausted run budget must refuse immediately, not execute"),
        },
        boundary,
        agentId: "worker",
        pollInterval: TimeSpan.FromMilliseconds(300),
        maxWait: TimeSpan.FromSeconds(8)); // would normally wait up to 8s -- runCreatedAtUtc should override this to ~0
    var sw7 = System.Diagnostics.Stopwatch.StartNew();
    // 590s "ago": with a 600s Foundry budget and a 30s safety margin, remaining budget = 600-590-30 = -20s.
    var result7 = await exhaustedExecutor.HandleAsync(
        new FoundryFunctionCall("call-7", "fs.write", new Dictionary<string, object?> { ["path"] = "/workspace/risky4.md" }),
        runCreatedAtUtc: DateTime.UtcNow - TimeSpan.FromSeconds(590));
    sw7.Stop();
    var output7 = result7["output"]?.ToString() ?? "";
    Check(
        "an exhausted run budget refuses immediately with a distinct reason, not the generic timeout message",
        output7.Contains("denied_by_governance") && output7.Contains("no time left to wait for approval") && !output7.Contains("still pending"),
        output7);
    Check("the refusal was near-instant, not an 8s wait -- proves effectiveMaxWait, not the configured maxWait, governed it", sw7.Elapsed < TimeSpan.FromSeconds(2), $"elapsed={sw7.Elapsed.TotalSeconds:F2}s");

    // The decision was still filed for operator visibility despite the immediate client-side refusal --
    // clean it up via a distinct operator so it doesn't leak into later pending-decision inspection.
    try
    {
        var leftoverId7 = await FindSinglePendingDecisionAsync(url, operatorToken);
        await operatorClient.ResolveDecisionAsync(leftoverId7, "deny", operatorClient);
        Check("a decision was still filed for operator visibility despite the immediate client-side refusal", true, leftoverId7);
    }
    catch (Exception e)
    {
        Check("a decision was still filed for operator visibility despite the immediate client-side refusal", false, e.Message);
    }
}

// --- Test app #8: runCreatedAtUtc with AMPLE budget remaining -- ask path still resolves normally,
// proving the new parameter doesn't change behavior for the ordinary case. Mirrors run_tests.py's
// Test app #8. ---
{
    var executorTask8 = Task.Run(async () =>
    {
        var executor8 = new GovernedFoundryExecutor(
            workerClient,
            new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
            {
                ["fs.write"] = args => new { written = true },
            },
            boundary,
            agentId: "worker",
            pollInterval: TimeSpan.FromMilliseconds(300),
            maxWait: TimeSpan.FromSeconds(15));
        return await executor8.HandleAsync(
            new FoundryFunctionCall("call-8", "fs.write", new Dictionary<string, object?> { ["path"] = "/workspace/risky5.md" }),
            runCreatedAtUtc: DateTime.UtcNow - TimeSpan.FromSeconds(10)); // only 10s elapsed of the 600s budget
    });

    await Task.Delay(500);
    var pendingId8 = await FindSinglePendingDecisionAsync(url, operator2Token);
    var (resolveOk8, resolveReason8) = await operator2Client.ResolveDecisionAsync(pendingId8, "approve", operator2Client);
    Check("with ample run budget remaining, a distinct operator can still approve it", resolveOk8, resolveReason8);

    var finalResult8 = await executorTask8;
    var output8 = finalResult8["output"]?.ToString() ?? "";
    Check("with ample run budget remaining, approving the ask still resumes the run normally (executes, doesn't stall)", output8.Contains("\"written\":true"), output8);
}

// --- Test app #9: filing the ask itself fails (sidecar reachable enough for DecideAsync, but
// /v1/decisions errors) -- must fail closed via a governed refusal, not an unhandled exception. Mirrors
// run_tests.py's Test app #9 -- a gap found on review: FileDecisionAsync's InvalidOperationException was
// never caught inside HandleAsync, breaking this class's own "never throws for a governance denial"
// contract. See IMPLEMENTATION_PLAN.md Sec 6v. Uses a minimal HttpListener-based stand-in rather than
// server_stub.mjs, since this specifically needs decide() to succeed (ask=true) while /v1/decisions
// fails -- a distinction server_stub.mjs's real wire-protocol behavior doesn't let a caller force. ---
{
    using var brokenListener = new System.Net.HttpListener();
    var brokenPort = 34567 + Random.Shared.Next(1000); // avoid colliding with the real sidecar's port
    brokenListener.Prefixes.Add($"http://127.0.0.1:{brokenPort}/");
    brokenListener.Start();
    var brokenServerTask = Task.Run(async () =>
    {
        while (brokenListener.IsListening)
        {
            System.Net.HttpListenerContext ctx;
            try { ctx = await brokenListener.GetContextAsync(); }
            catch (Exception) { break; } // listener stopped
            var req = ctx.Request;
            using var reader = new System.IO.StreamReader(req.InputStream);
            await reader.ReadToEndAsync();
            if (req.Url!.AbsolutePath == "/v1/decide")
            {
                var payload = System.Text.Encoding.UTF8.GetBytes("{\"allow\":false,\"ask\":true,\"reason\":\"test ask\"}");
                ctx.Response.StatusCode = 200;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.OutputStream.WriteAsync(payload);
            }
            else if (req.Url.AbsolutePath == "/v1/decisions")
            {
                ctx.Response.StatusCode = 500; // simulated transient filing failure
            }
            else
            {
                ctx.Response.StatusCode = 404;
            }
            ctx.Response.Close();
        }
    });

    try
    {
        var brokenClient = new StarfishSidecarClient($"http://127.0.0.1:{brokenPort}", "whatever-token");
        var brokenExecutor = new GovernedFoundryExecutor(
            brokenClient,
            new Dictionary<string, Func<IReadOnlyDictionary<string, object?>, object?>>
            {
                ["fs.write"] = args => throw new Exception("SHOULD NEVER EXECUTE -- a filing failure must refuse, not execute"),
            },
            boundary,
            agentId: "worker");
        var result9 = await brokenExecutor.HandleAsync(new FoundryFunctionCall("call-9", "fs.write", new Dictionary<string, object?> { ["path"] = "/workspace/x" }));
        var output9 = result9["output"]?.ToString() ?? "";
        Check(
            "filing the ask itself failing returns a fail-closed refusal, not an unhandled exception",
            output9.Contains("denied_by_governance") && output9.Contains("could not file the ask"),
            output9);
    }
    finally
    {
        brokenListener.Stop();
        brokenListener.Close();
    }
}

// --- Bonus check: PollDecisionAsync's own "unknown" return for a decision id that was never filed --
// confirms, for real (not mocked), the input condition Test app #6's comment above explains HandleAsync's
// fixed timedOut tracking now handles correctly regardless of WHICH non-"pending" status caused it. ---
{
    var unknownStatus = await workerClient.PollDecisionAsync("dec_this_id_was_never_filed_by_anything");
    Check("PollDecisionAsync returns 'unknown' for a decision id that was never filed", unknownStatus == "unknown", $"status={unknownStatus}");
}

var passed = results.Count(r => r.Ok);
foreach (var (name, ok, detail) in results)
    Console.WriteLine($"  [{(ok ? "PASS" : "FAIL")}] {name} -- {detail}");
Console.WriteLine($"\n{passed}/{results.Count} dotnet adapter checks passed");
Environment.Exit(passed == results.Count ? 0 : 1);

static async Task<string> FindSinglePendingDecisionAsync(string url, string token)
{
    using var http = new HttpClient();
    var req = new HttpRequestMessage(HttpMethod.Get, url.TrimEnd('/') + "/v1/pending");
    req.Headers.Add("x-starfish-wire", "1");
    req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    var resp = await http.SendAsync(req);
    var raw = await resp.Content.ReadAsStringAsync();
    using var doc = System.Text.Json.JsonDocument.Parse(raw);
    var arr = doc.RootElement;
    if (arr.ValueKind != System.Text.Json.JsonValueKind.Array || arr.GetArrayLength() == 0)
        throw new Exception($"expected exactly one pending decision, got: {raw}");
    return arr[0].GetProperty("id").GetString()!;
}
