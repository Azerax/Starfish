// Starfish governance adapter for Azure AI Foundry Agent Service -- .NET port.
//
// Mirrors python-adapter/starfish_foundry_adapter/__init__.py 1:1, which itself mirrors
// packages/sdk/src/client.ts's makeSidecarRunner() protocol exactly: bearer-token auth, the
// x-starfish-wire handshake header, and the same /v1/decide, /v1/decisions, /v1/decisions/{id}
// endpoint shapes -- the sidecar does not need to know or care which language is calling it.
//
// VERIFIED, not just ported-by-hand: compiles clean, and its own test harness (7/7) passes against both
// server_stub.mjs AND a real containerized governance-core PDP -- see IMPLEMENTATION_PLAN.md Sec 6c for
// the real-container run (which found and fixed one bug, in the test harness's own boundary fixture, not
// in this file) and Sec 6a/README.md for the earlier compile/stub verification.
//
// Deployment assumption (see docs/design/azure.md Sec 3): the sidecar's serve.ts binds loopback-only by
// design (127.0.0.1). This adapter and the sidecar MUST run in the same pod / same Container Apps
// revision. Do not attempt to route this adapter to a sidecar on a different host -- it will be rejected
// by serve.ts's loopback + Host-header checks by design.

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Starfish.FoundryAdapter;

/// <summary>
/// Raised when the sidecar cannot be reached at all. Callers MUST treat this as a deny, never as allow --
/// fail-closed is the one invariant every layer of Starfish holds, and this adapter is not exempt just
/// because it's new code in a new language.
/// </summary>
public sealed class StarfishUnreachableException : Exception
{
    public StarfishUnreachableException(string message, Exception? inner = null) : base(message, inner) { }
}

public sealed record Decision(bool Allow, bool Ask, string Reason);

/// <summary>
/// Thin HTTP client for one governed root's sidecar endpoint. One instance per (root, actor). Not
/// thread-safe beyond what HttpClient itself guarantees; construct one per logical actor identity.
/// </summary>
public sealed class StarfishSidecarClient
{
    private const int WireVersion = 1; // must match packages/sdk/src/serve.ts's WIRE_VERSION exactly

    private readonly HttpClient _http;
    private readonly string _baseUrl; // e.g. "http://127.0.0.1:8787" -- MUST be loopback, see file header
    private readonly string _token;

    public StarfishSidecarClient(string baseUrl, string token, HttpClient? httpClient = null, TimeSpan? timeout = null)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _token = token;
        _http = httpClient ?? new HttpClient();
        _http.Timeout = timeout ?? TimeSpan.FromSeconds(5);
    }

    private async Task<(int Status, JsonElement Body)> CallAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var req = new HttpRequestMessage(method, _baseUrl + path);
        req.Headers.Add("x-starfish-wire", WireVersion.ToString());
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        if (body is not null)
        {
            var json = JsonSerializer.Serialize(body);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        HttpResponseMessage resp;
        try
        {
            resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            // Fail-closed: any transport error becomes StarfishUnreachable, never a silent "treat as ok".
            throw new StarfishUnreachableException(e.Message, e);
        }

        var raw = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        JsonElement parsed = default;
        if (!string.IsNullOrEmpty(raw))
        {
            try { parsed = JsonDocument.Parse(raw).RootElement; }
            catch (JsonException) { /* leave parsed as default -- caller treats missing fields as absent */ }
        }
        return ((int)resp.StatusCode, parsed);
    }

    private static bool GetBool(JsonElement body, string prop) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.True;

    private static string GetString(JsonElement body, string prop, string fallback = "") =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? fallback
            : fallback;

    /// <summary>
    /// POST /v1/decide -- the synchronous gate. Fail-closed: any transport error or non-200 response is a
    /// deny, never an allow, matching client.ts's makeSidecarRunner().decide() and the Python adapter.
    /// </summary>
    public async Task<Decision> DecideAsync(object call, object boundary, CancellationToken ct = default)
    {
        try
        {
            var (status, body) = await CallAsync(HttpMethod.Post, "/v1/decide", new { call, boundary }, ct).ConfigureAwait(false);
            if (status != 200)
                return new Decision(false, false, $"fail-closed: sidecar returned {status}");
            return new Decision(GetBool(body, "allow"), GetBool(body, "ask"), GetString(body, "reason"));
        }
        catch (StarfishUnreachableException e)
        {
            return new Decision(false, false, $"fail-closed: sidecar unreachable ({e.Message})");
        }
    }

    /// <summary>POST /v1/decisions -- park an 'ask' for operator approval. Returns the decision id.</summary>
    public async Task<string> FileDecisionAsync(string actor, string tool, string target, string reason, string riskTier = "high", CancellationToken ct = default)
    {
        var (status, body) = await CallAsync(
            HttpMethod.Post, "/v1/decisions",
            new { decision = new { actor, tool, target, reason, riskTier } }, ct).ConfigureAwait(false);
        if (status != 200)
            throw new InvalidOperationException($"failed to file decision: HTTP {status}");
        return GetString(body, "id");
    }

    /// <summary>GET /v1/decisions/{id} -- "pending" | "approved" | "denied" | "unknown".</summary>
    public async Task<string> PollDecisionAsync(string decisionId, CancellationToken ct = default)
    {
        var (status, body) = await CallAsync(HttpMethod.Get, $"/v1/decisions/{decisionId}", null, ct).ConfigureAwait(false);
        if (status != 200) return "unknown";
        return GetString(body, "status", "unknown");
    }

    /// <summary>
    /// POST /v1/decisions/{id} using a DIFFERENT identity's client than the one that filed it -- the
    /// sidecar enforces proposer != approver server-side regardless, but the adapter should never even
    /// construct a call that could look like self-approval.
    ///
    /// <paramref name="verdict"/> MUST be exactly "approve" or "deny". Found the hard way tonight, not
    /// by inspection (IMPLEMENTATION_PLAN.md Sec 6k): serve.ts's wire protocol is
    /// <c>verdict === 'deny' ? 'deny' : 'approve'</c> -- ANY string other than the literal "deny" is
    /// silently treated as an APPROVAL, with no error and nothing in the 200 OK response to distinguish
    /// it from a real approval. This project's OWN earlier test code called this with "denied" (plain,
    /// natural English) and it silently approved instead -- the precise opposite of fail-closed.
    /// Validated client-side here rather than trusting every caller to get the exact string right.
    /// </summary>
    public async Task<(bool Ok, string Reason)> ResolveDecisionAsync(string decisionId, string verdict, StarfishSidecarClient resolver, CancellationToken ct = default)
    {
        if (verdict != "approve" && verdict != "deny")
        {
            throw new ArgumentException(
                $"ResolveDecisionAsync: verdict must be exactly \"approve\" or \"deny\", got \"{verdict}\" -- " +
                "refusing client-side rather than risking a silent unintended grant (the sidecar's wire " +
                "protocol treats any non-\"deny\" string as an approval)",
                nameof(verdict));
        }
        var (_, body) = await resolver.CallAsync(HttpMethod.Post, $"/v1/decisions/{decisionId}", new { verdict }, ct).ConfigureAwait(false);
        return (GetBool(body, "ok"), GetString(body, "reason"));
    }
}
