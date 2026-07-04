// Loopback sidecar: the governed decision + approval API over HTTP for any-language host skills. Security
// by construction: 127.0.0.1 only, Host-header check, bearer-token auth, wire-version handshake,
// body-size cap, server-assigned actor identity + strict input allowlist so proposer != approver holds.
// v0.19.0: one sidecar can govern MULTIPLE governed roots with hard per-root isolation — a token maps to
// exactly one root's context (its own governance, broker, audit, pending, resolved map, operator set), so
// one tenant's tokens/pending/audit can never address or leak into another (embed risks #22, #39; A20).
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { Governance } from './index';

export const WIRE_VERSION = 1;
export const MAX_BODY_BYTES = 256 * 1024;
const RISK_TIERS = ['low', 'medium', 'high', 'critical'];
export interface SidecarIdentity { token: string; actor: string }
export interface SidecarOptions { governance: Governance; identities: SidecarIdentity[]; host?: string; port?: number }
/** A governed root exposed by a multi-tenant sidecar. `operators` restricts who may approve (A20); if
 *  omitted, any non-proposer may approve (single-tenant legacy behavior). */
export interface RootSpec { id: string; governance: Governance; identities: SidecarIdentity[]; operators?: string[] }
export interface MultiSidecarOptions { roots: RootSpec[]; host?: string; port?: number }
export interface Sidecar { server: Server; port: number; url: string; close(): Promise<void> }

// Per-token context: the ONE root a token can act within. `resolved` is per-root so decision outcomes
// never cross tenants.
interface Ctx { rootId: string; gov: Governance; actor: string; operators?: readonly string[]; resolved: Map<string, 'approve' | 'deny'> }

function readJson(req: IncomingMessage): Promise<{ body: Record<string, unknown>; tooLarge: boolean }> {
  return new Promise((resolve) => {
    let d = ''; let over = false;
    req.on('data', (c) => { if (over) return; d += c; if (d.length > MAX_BODY_BYTES) { over = true; d = ''; } });
    req.on('end', () => { if (over) return resolve({ body: {}, tooLarge: true }); try { resolve({ body: d ? JSON.parse(d) : {}, tooLarge: false }); } catch { resolve({ body: {}, tooLarge: false }); } });
    req.on('error', () => resolve({ body: {}, tooLarge: over }));
  });
}
const tokenEq = (a: string, b: string): boolean => { const ab = Buffer.from(a), bb = Buffer.from(b); return ab.length === bb.length && timingSafeEqual(ab, bb); };
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const hostOk = (req: IncomingMessage): boolean => {
  const hh = String(req.headers['host'] ?? '');
  if (!hh) return true;
  const hn = hh.replace(/^\[/, '').split(/[:\]]/)[0];
  return hn === '127.0.0.1' || hn === 'localhost' || hn === '::1';
};

// Build the sidecar server from a token->context resolver. The resolver is the ONLY place tenancy is
// decided; the handler below is tenant-agnostic and always operates through the resolved context.
function buildSidecar(resolveCtx: (req: IncomingMessage) => Ctx | null, host: string, port: number): Promise<Sidecar> {
  const sockets = new Set<Socket>();
  const server = createServer((req, res: ServerResponse) => {
    void (async () => {
      const send = (code: number, obj: unknown): void => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        const ra = req.socket.remoteAddress ?? '';
        if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) return send(403, { error: 'loopback only' });
        if (!hostOk(req)) return send(421, { error: 'bad host header (loopback only)' });
        const url = req.url ?? '';
        const method = req.method ?? 'GET';

        if (method === 'GET' && url === '/v1/health') return send(200, { ok: true, wire: WIRE_VERSION });

        const wire = Number(req.headers['x-starfish-wire']);
        if (wire !== WIRE_VERSION) return send(426, { error: `wire mismatch: server ${WIRE_VERSION}, client ${req.headers['x-starfish-wire'] ?? 'none'}` });

        const ctx = resolveCtx(req);
        if (!ctx) return send(401, { error: 'invalid or missing token' });
        const gov = ctx.gov;

        // Live push channel (SSE). Redacted + scoped: audit events projected (no `detail`); a non-operator
        // identity only sees its own actor's events + system events / its own pending. Root-scoped by ctx.
        if (method === 'GET' && url === '/v1/stream') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          const isOp = ctx.actor === 'operator' || (ctx.operators?.includes(ctx.actor) ?? false);
          const scoped = (e: { actor?: string; domain?: string }): boolean => isOp || e.actor === ctx.actor || e.domain === 'system';
          const slim = (e: Record<string, unknown>) => ({ seq: e.seq, ts: e.ts, actor: e.actor, domain: e.domain, action: e.action, target: e.target, decision: e.decision, reason: e.reason, riskTier: e.riskTier });
          const emit = (event: string, data: unknown): void => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* peer gone */ } };
          const pendingSnapshot = () => gov.broker.list().filter((p) => isOp || p.actor === ctx.actor).map((p) => ({ id: p.id, tool: p.tool, actor: p.actor, target: p.target, reason: p.reason, riskTier: p.riskTier }));
          let cursor = gov.governor.audit.head().seq + 1;
          emit('hello', { wire: WIRE_VERSION, since: cursor, root: ctx.rootId });
          const tick = (): void => {
            try {
              const evs = gov.governor.audit.recent(500, cursor).filter((e) => scoped(e as unknown as { actor?: string; domain?: string }));
              for (const e of evs) emit('audit', slim(e as unknown as Record<string, unknown>));
              const head = gov.governor.audit.head().seq + 1; if (head > cursor) cursor = head;
              emit('pending', pendingSnapshot());
              emit('budgets', gov.governor.tokens.snapshot());
              emit('monitor', { counters: gov.governor.monitor.counters(), safeMode: gov.safeMode() });
            } catch { /* fail soft */ }
          };
          const dataIv = setInterval(tick, 1000);
          const kaIv = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
          const stop = (): void => { clearInterval(dataIv); clearInterval(kaIv); try { res.end(); } catch { /* noop */ } };
          req.on('close', stop); req.on('error', stop);
          tick();
          return;
        }

        const { body, tooLarge } = await readJson(req);
        if (tooLarge) return send(413, { error: 'request body too large' });

        if (method === 'POST' && url === '/v1/decide') {
          return send(200, gov.governCall(body.call as never, body.boundary as never));
        }
        if (method === 'POST' && url === '/v1/decisions') {
          const raw = (body.decision ?? {}) as Record<string, unknown>;   // strict allowlist; server owns actor/kind/refId (audit A6)
          const dec = {
            actor: ctx.actor,
            kind: 'tool',
            tool: str(raw.tool, 120) ?? 'unknown',
            target: str(raw.target, 1024),
            reason: str(raw.reason, 2000) ?? '',
            riskTier: RISK_TIERS.includes(String(raw.riskTier)) ? String(raw.riskTier) : 'high',
            refId: ctx.actor + ':' + (str(raw.refId, 120) ?? randomUUID()),
          };
          const rec = gov.broker.file(dec as Parameters<typeof gov.broker.file>[0]);
          return send(200, { id: rec.id });
        }
        if (method === 'GET' && url === '/v1/pending') {
          return send(200, gov.broker.list().map((p) => ({ id: p.id, tool: p.tool, actor: p.actor, target: p.target, reason: p.reason, riskTier: p.riskTier })));
        }
        if (method === 'GET' && url === '/v1/audit') return send(200, gov.governor.audit.recent(50));
        if (method === 'GET' && url === '/v1/audit/verify') return send(200, { ok: gov.verifyAudit() });
        if (method === 'GET' && url === '/v1/budgets') return send(200, gov.governor.tokens.snapshot());
        if (method === 'GET' && url === '/v1/monitor') return send(200, { counters: gov.governor.monitor.counters(), safeMode: gov.safeMode() });
        if (method === 'GET' && url.startsWith('/v1/decisions/')) {
          const decId = decodeURIComponent(url.slice('/v1/decisions/'.length));
          if (gov.broker.list().some((p) => p.id === decId)) return send(200, { status: 'pending' });
          const v = ctx.resolved.get(decId);
          return send(200, { status: v === 'approve' ? 'approved' : v === 'deny' ? 'denied' : 'unknown' });
        }
        if (method === 'POST' && url.startsWith('/v1/decisions/')) {
          const decId = decodeURIComponent(url.slice('/v1/decisions/'.length));
          const verdict = body.verdict === 'deny' ? 'deny' : 'approve';
          const r = gov.broker.resolve(decId, verdict, ctx.actor, ctx.operators);
          if (r.ok) ctx.resolved.set(decId, verdict);
          return send(r.ok ? 200 : 409, { ok: r.ok, reason: r.reason });
        }
        return send(404, { error: 'not found' });
      } catch (e) { return send(500, { error: (e as Error).message }); }
    })();
  });

  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  return new Promise<Sidecar>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server, port: boundPort, url: `http://${host}:${boundPort}`,
        close: () => new Promise<void>((r) => { for (const s of sockets) { try { s.destroy(); } catch { /* noop */ } } server.close(() => r()); }),
      });
    });
  });
}

export async function startSidecar(opts: SidecarOptions): Promise<Sidecar> {
  const host = opts.host ?? '127.0.0.1';
  const resolved = new Map<string, 'approve' | 'deny'>();
  const resolveCtx = (req: IncomingMessage): Ctx | null => {
    const h = String(req.headers['authorization'] ?? '');
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return null;
    const idn = opts.identities.find((i) => tokenEq(i.token, tok));
    if (!idn) return null;
    return { rootId: 'default', gov: opts.governance, actor: idn.actor, operators: undefined, resolved };
  };
  return buildSidecar(resolveCtx, host, opts.port ?? 0);
}

/** One loopback sidecar governing several roots with hard per-root isolation. A token belongs to exactly
 *  one root; requests are routed to that root's governance/broker/audit and can never address another. */
export async function startMultiSidecar(opts: MultiSidecarOptions): Promise<Sidecar> {
  const host = opts.host ?? '127.0.0.1';
  // token -> context. A duplicate token across roots is rejected at construction (ambiguous tenancy).
  const byToken = new Map<string, Ctx>();
  for (const root of opts.roots) {
    const resolved = new Map<string, 'approve' | 'deny'>();
    for (const idn of root.identities) {
      if (byToken.has(idn.token)) throw new Error(`startMultiSidecar: duplicate token across roots (ambiguous tenancy) for root ${root.id}`);
      byToken.set(idn.token, { rootId: root.id, gov: root.governance, actor: idn.actor, operators: root.operators, resolved });
    }
  }
  const resolveCtx = (req: IncomingMessage): Ctx | null => {
    const h = String(req.headers['authorization'] ?? '');
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return null;
    for (const [t, ctx] of byToken) if (tokenEq(t, tok)) return ctx;   // constant-time compare per token
    return null;
  };
  return buildSidecar(resolveCtx, host, opts.port ?? 0);
}
