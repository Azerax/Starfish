// Tier-2 governance: a reverse proxy in front of a customer's MCP or OpenAPI tool backend, for the class
// of Foundry tools that Foundry's SERVICE itself calls directly (not the calling application) -- see
// docs/design/azure.md Sec 2 for why this tier needs a network-level intermediary instead of the
// in-process gate the Tier-1 adapters (python-adapter, dotnet-adapter) provide.
//
// ARCHITECTURAL DIFFERENCE FROM THE TIER-1 SIDECAR, worth stating plainly: serve.ts binds loopback-only
// because only the customer's own co-located app container ever needs to reach it. This gateway is the
// opposite -- Foundry's service has to reach it over the network (wherever the customer's MCP/OpenAPI
// endpoint URL is registered), so it CANNOT be loopback-bound and needs its own real ingress, its own
// TLS, and its own inbound authentication story (not modeled yet -- see the "not solved" list below).
// Do not copy the Tier-1 sidecar's network assumptions onto this component; they are different shapes.
//
// KNOWN, NOT-SOLVED LIMITATION (stated here rather than hidden): a Tier-1 'ask' can hold the calling
// application's own execution loop open for up to ~8 minutes (see GovernedFoundryExecutor.max_wait_seconds)
// because the app is in control of that wait. This gateway sits between Foundry's service and the tool
// backend, and neither this repo nor Microsoft's public documentation (as researched for docs/design/
// azure.md) establishes how long Foundry itself will wait for an MCP tool call or OpenAPI action to
// respond before timing out the run. Blocking synchronously on this gateway for an unknown, possibly
// short window risks Foundry timing the call out anyway, which would look identical to a network failure
// to the agent -- worse than an honest, fast denial. So for now: an 'ask' outcome here is filed for
// operator visibility (POST /v1/decisions, same as Tier-1) but the REQUEST ITSELF degrades to an
// immediate deny, not a synchronous wait. This is a real capability gap versus Tier-1, not a design
// choice to be proud of -- it's flagged as an open item in the implementation plan, not silently
// smoothed over.
//
// NOT YET DEPLOYED anywhere -- this is a first pass at the proxy logic plus its own smoke test
// (tier2.smoketest.mjs) against fake upstream + fake sidecar servers. It has not been run against a real
// MCP server, a real OpenAPI backend, or a real Foundry-initiated call.
//
// TWO FURTHER GAPS, found by re-reading this file adversarially rather than assuming the first draft was
// complete (see IMPLEMENTATION_PLAN.md Sec 6a for the session this happened in):
//
// 1. THIS GATEWAY DOES NOT AUTHENTICATE ITS CALLERS. It governs and audits tool-shaped requests, but
//    unlike the Tier-1 sidecar (loopback-bound, effectively unreachable except by a co-located process),
//    this gateway has a real network ingress by necessity, and nothing in createTier2Gateway() checks who
//    is calling before running the classify -> decide -> proxy pipeline. A non-tool-call request (classify
//    returns null, e.g. MCP's tools/list) is proxied to the real backend with ZERO governance AND zero
//    gateway-level auth check. The security model as originally written depends entirely on network
//    placement (only Foundry's service can reach this endpoint) plus whatever auth the upstream backend
//    itself still enforces on forwarded headers. That's a real, present-day gap for anyone who deploys
//    this with an open or misconfigured ingress. Partially mitigated below with an optional shared-secret
//    check (`requireSharedSecret`) -- opt-in, not default, because enabling it is a deployment decision
//    (Foundry needs to be configured to send the header) this file can't make unilaterally. A missing
//    `requireSharedSecret` produces a loud startup warning instead of silent trust, on purpose.
// 2. ONE GATEWAY INSTANCE GOVERNS EVERY CALLER AS THE SAME STATIC `agentId`. Unlike the Tier-1 adapters,
//    where `agentId` is the actual calling application's own configured identity, this gateway's agentId
//    comes from `Tier2GatewayOptions.agentId` -- a single, gateway-wide config value, not derived from the
//    request. If one gateway instance fronts MCP/OpenAPI calls for MULTIPLE distinct Foundry agents, they
//    are indistinguishable to governance: audited and decided as one actor, not per-agent. The correct
//    mitigation is almost certainly "one gateway instance per governed agent," mirroring the Tier-1
//    "one adapter config per agent" pattern -- not attempting to invent a way to extract per-caller agent
//    identity from an MCP/OpenAPI request shape that varies by backend and isn't standardized for this.

import http from 'node:http';
import { request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// Same constant-time comparison pattern as packages/sdk/src/serve.ts's own `tokenEq` (used there for
// bearer-token auth) -- found on review that this file's shared-secret check used a plain `!==` string
// comparison instead, the one secret-bearing comparison in this codebase NOT using the project's own
// established pattern for this. A plain `!==`/`===` on strings in V8 short-circuits at the first
// differing byte, which is a real (if narrow -- it needs network-level timing precision and many
// requests) timing side channel on `requireSharedSecret`'s value. Matched to the existing standard rather
// than inventing a second way to do the same thing.
const secretEq = (a: string, b: string): boolean => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export type ProtocolKind = 'mcp' | 'openapi';

/** What the classifier extracts from an incoming request, or null if this request is not a tool
 *  EXECUTION call (e.g. MCP's `initialize`/`tools/list`, or an OpenAPI discovery/health endpoint) and
 *  should simply pass through ungoverned. Governing "what tools exist" the same way as "run this tool"
 *  would be a category error -- listing is not doing. */
export interface ClassifiedCall {
  tool: string;
  target: string;
  input: unknown;
  /** For MCP JSON-RPC calls, the request's `id` field, needed to shape a spec-conformant JSON-RPC error
   *  response on denial. Undefined for OpenAPI (REST denials just use HTTP status + JSON body). */
  jsonRpcId?: string | number | null;
}

export interface Tier2GatewayOptions {
  /** Where the REAL MCP/OpenAPI tool backend lives. This gateway proxies allowed calls here unchanged. */
  upstreamBaseUrl: string;
  /** The Starfish sidecar this gateway asks for decisions. NOTE: this presumes a sidecar reachable from
   *  wherever this gateway runs -- if this gateway is NOT co-located with a Tier-1 sidecar (its own
   *  network position argues it usually won't be), this needs a non-loopback sidecar endpoint, which
   *  serve.ts does not support today. Open item: either run a second, non-loopback-bound sidecar
   *  instance for Tier-2 gateways to call, or extend serve.ts's host-allow logic -- NOT decided yet, see
   *  the implementation plan's open-decisions list. */
  sidecarBaseUrl: string;
  sidecarToken: string;
  agentId: string;
  boundary: unknown;
  protocol: ProtocolKind;
  classify: (method: string, url: string, bodyJson: unknown) => ClassifiedCall | null;
  /** Injectable for tests; defaults to Node's real http.request. */
  httpRequestImpl?: typeof httpRequest;
  /** Opt-in caller authentication -- see the "gap 1" header comment above for why this is opt-in rather
   *  than mandatory (this file can't unilaterally decide Foundry's outbound header configuration). When
   *  set, every request must carry `x-starfish-gateway-secret` matching this value exactly, checked
   *  BEFORE classify()/proxy logic runs -- a mismatch or missing header is an immediate 401, logged and
   *  audited nowhere (a wrong secret is noise, not a governance decision). This is a shared-secret check,
   *  not a substitute for TLS or network-level restriction -- pair it with both in a real deployment. */
  requireSharedSecret?: string;
}

const WIRE_VERSION = 1; // must match packages/sdk/src/serve.ts's WIRE_VERSION exactly

async function sidecarDecide(opts: Tier2GatewayOptions, call: ClassifiedCall): Promise<{ allow: boolean; ask: boolean; reason: string }> {
  const url = opts.sidecarBaseUrl.replace(/\/$/, '') + '/v1/decide';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-starfish-wire': String(WIRE_VERSION),
        authorization: `Bearer ${opts.sidecarToken}`,
      },
      body: JSON.stringify({ call: { agentId: opts.agentId, tool: call.tool, input: call.input }, boundary: opts.boundary }),
    });
    if (!resp.ok) return { allow: false, ask: false, reason: `fail-closed: sidecar returned ${resp.status}` };
    const body = await resp.json();
    return { allow: !!body.allow, ask: !!body.ask, reason: String(body.reason ?? '') };
  } catch (e) {
    // Fail-closed: any transport error is a deny, same invariant as every other Starfish client.
    return { allow: false, ask: false, reason: `fail-closed: sidecar unreachable (${(e as Error).message})` };
  }
}

async function fileAskForVisibility(opts: Tier2GatewayOptions, call: ClassifiedCall, reason: string): Promise<string | null> {
  const url = opts.sidecarBaseUrl.replace(/\/$/, '') + '/v1/decisions';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-starfish-wire': String(WIRE_VERSION),
        authorization: `Bearer ${opts.sidecarToken}`,
      },
      body: JSON.stringify({ decision: { actor: opts.agentId, tool: call.tool, target: call.target, reason, riskTier: 'medium' } }),
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    return body.id ?? null;
  } catch {
    // Best-effort only -- failing to file the visibility record must not change the deny outcome that
    // already fired; the request is denied either way.
    return null;
  }
}

function denyBody(opts: Tier2GatewayOptions, call: ClassifiedCall, reason: string, decisionId: string | null) {
  if (opts.protocol === 'mcp') {
    return {
      status: 200, // JSON-RPC errors are still HTTP 200 by convention; the error is in the body
      body: {
        jsonrpc: '2.0',
        id: call.jsonRpcId ?? null,
        error: { code: -32001, message: 'denied_by_governance', data: { reason, decisionId } },
      },
    };
  }
  return {
    status: 403,
    body: { error: 'denied_by_governance', reason, decisionId },
  };
}

/** Proxies the raw upstream response back to the original caller, unmodified. */
function proxyToUpstream(opts: Tier2GatewayOptions, req: http.IncomingMessage, rawBody: Buffer, res: http.ServerResponse) {
  const upstream = new URL(opts.upstreamBaseUrl.replace(/\/$/, '') + (req.url ?? ''));
  const impl = opts.httpRequestImpl ?? httpRequest;
  const upstreamReq = impl(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path: upstream.pathname + upstream.search,
      method: req.method,
      headers: { ...req.headers, host: upstream.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_unreachable', reason: e.message }));
  });
  upstreamReq.end(rawBody);
}

export function createTier2Gateway(opts: Tier2GatewayOptions): http.Server {
  if (!opts.requireSharedSecret) {
    // eslint-disable-next-line no-console -- deliberate: this must be visible in any deployment's boot
    // logs, not silently swallowed, since it's a statement about the gateway's own trust model.
    console.warn(
      '[tier2-gateway] WARNING: requireSharedSecret is not set. This gateway will accept requests from ' +
      'anyone who can reach it over the network with no auth check of its own -- see gateway.ts\'s ' +
      '"gap 1" header comment. Fine for local testing; set requireSharedSecret (and configure Foundry to ' +
      'send it) before pointing a real deployment at this.',
    );
  }

  return http.createServer(async (req, res) => {
    if (opts.requireSharedSecret) {
      const provided = req.headers['x-starfish-gateway-secret'];
      // Node comma-joins most duplicated headers into one string (a FEW special header names, not this
      // one, become a real string[] -- see IncomingHttpHeaders' own type, which allows for either). Either
      // shape a duplicated header could take is rejected here: a comma-joined string won't equal the real
      // secret, and the `typeof` guard catches the array case outright -- neither is "the caller sent
      // exactly the right secret and nothing else," which is the only thing this check should accept.
      const ok = typeof provided === 'string' && secretEq(provided, opts.requireSharedSecret);
      if (!ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized', reason: 'missing or incorrect x-starfish-gateway-secret' }));
        return;
      }
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks);

    let bodyJson: unknown = undefined;
    if (rawBody.length > 0) {
      try { bodyJson = JSON.parse(rawBody.toString('utf-8')); } catch { /* not JSON; classify() gets undefined */ }
    }

    let classified: ClassifiedCall | null;
    try {
      classified = opts.classify(req.method ?? 'GET', req.url ?? '/', bodyJson);
    } catch (e) {
      // A broken classifier fails closed too -- an exception here must not fall through to an
      // ungoverned passthrough just because the classification logic itself errored.
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'classifier_error', reason: (e as Error).message }));
      return;
    }

    if (classified === null) {
      // Not a tool-execution call (discovery/handshake/etc) -- pass through ungoverned.
      proxyToUpstream(opts, req, rawBody, res);
      return;
    }

    const decision = await sidecarDecide(opts, classified);

    if (decision.ask) {
      const decisionId = await fileAskForVisibility(opts, classified, decision.reason);
      const { status, body } = denyBody(
        opts, classified,
        `ask degraded to deny: Tier-2 gateway cannot hold a synchronous wait for operator approval (see gateway.ts header comment). Filed for review as ${decisionId ?? '(filing failed)'}.`,
        decisionId,
      );
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    if (!decision.allow) {
      const { status, body } = denyBody(opts, classified, decision.reason, null);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    proxyToUpstream(opts, req, rawBody, res);
  });
}

/** A starter classifier for MCP's JSON-RPC `tools/call` method. Real MCP servers may batch requests or
 *  use transports other than plain HTTP POST (e.g. SSE) -- this covers the single-request HTTP POST
 *  shape only, matching what could actually be tested tonight without a real MCP server to probe. */
export function classifyMcpToolsCall(_method: string, _url: string, bodyJson: unknown): ClassifiedCall | null {
  if (!bodyJson || typeof bodyJson !== 'object') return null;
  const b = bodyJson as Record<string, unknown>;
  if (b.method !== 'tools/call' || typeof b.params !== 'object' || b.params === null) return null;
  const params = b.params as Record<string, unknown>;
  const name = params.name;
  if (typeof name !== 'string') return null;
  return {
    tool: name,
    target: name,
    input: params.arguments ?? {},
    jsonRpcId: (b.id as string | number | null | undefined) ?? null,
  };
}
