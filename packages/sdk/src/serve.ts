// Loopback sidecar: exposes the governed decision + approval API over HTTP so any-language host skills
// (and a custom dashboard) can gate themselves with zero in-process coupling. Security by construction:
// 127.0.0.1 only, bearer-token auth, wire-version handshake, and server-assigned actor identity (the
// caller's authority comes from its token, never from the request body) so proposer != approver holds.
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Governance } from './index';

export const WIRE_VERSION = 1;
export interface SidecarIdentity { token: string; actor: string }
export interface SidecarOptions { governance: Governance; identities: SidecarIdentity[]; host?: string; port?: number }
export interface Sidecar { server: Server; port: number; url: string; close(): Promise<void> }

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); });
}
const tokenEq = (a: string, b: string): boolean => { const ab = Buffer.from(a), bb = Buffer.from(b); return ab.length === bb.length && timingSafeEqual(ab, bb); };

export async function startSidecar(opts: SidecarOptions): Promise<Sidecar> {
  const host = opts.host ?? '127.0.0.1';
  const gov = opts.governance;
  const identify = (req: IncomingMessage): SidecarIdentity | null => {
    const h = String(req.headers['authorization'] ?? '');
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return null;
    return opts.identities.find((i) => tokenEq(i.token, tok)) ?? null;
  };

  const server = createServer((req, res) => {
    void (async () => {
      const send = (code: number, obj: unknown): void => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        const ra = req.socket.remoteAddress ?? '';
        if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) return send(403, { error: 'loopback only' });
        const url = req.url ?? '';
        const method = req.method ?? 'GET';

        // health is an unauthenticated probe so clients can discover the wire version first
        if (method === 'GET' && url === '/v1/health') return send(200, { ok: true, wire: WIRE_VERSION });

        // wire-version handshake on every real call (fail-closed on mismatch)
        const wire = Number(req.headers['x-starfish-wire']);
        if (wire !== WIRE_VERSION) return send(426, { error: `wire mismatch: server ${WIRE_VERSION}, client ${req.headers['x-starfish-wire'] ?? 'none'}` });

        const id = identify(req);
        if (!id) return send(401, { error: 'invalid or missing token' });

        const body = await readJson(req);
        if (method === 'POST' && url === '/v1/decide') {
          const d = gov.governCall(body.call as never, body.boundary as never);
          return send(200, d);
        }
        if (method === 'POST' && url === '/v1/decisions') {
          const dec = { ...(body.decision as Record<string, unknown>), actor: id.actor };   // actor from token, not body
          const rec = gov.broker.file(dec as Parameters<typeof gov.broker.file>[0]);
          return send(200, { id: rec.id });
        }
        if (method === 'GET' && url === '/v1/pending') {
          return send(200, gov.broker.list().map((p) => ({ id: p.id, tool: p.tool, actor: p.actor, target: p.target, reason: p.reason, riskTier: p.riskTier })));
        }
        if (method === 'GET' && url === '/v1/audit') {
          return send(200, gov.governor.audit.recent(50));
        }
        if (method === 'GET' && url === '/v1/audit/verify') {
          return send(200, { ok: gov.verifyAudit() });
        }
        if (method === 'GET' && url === '/v1/budgets') {
          return send(200, gov.governor.tokens.snapshot());
        }
        if (method === 'GET' && url === '/v1/monitor') {
          return send(200, { counters: gov.governor.monitor.counters(), safeMode: gov.safeMode() });
        }
        if (method === 'POST' && url.startsWith('/v1/decisions/')) {
          const decId = decodeURIComponent(url.slice('/v1/decisions/'.length));
          const r = gov.broker.resolve(decId, body.verdict === 'deny' ? 'deny' : 'approve', id.actor);   // by = token identity
          return send(r.ok ? 200 : 409, { ok: r.ok, reason: r.reason });
        }
        return send(404, { error: 'not found' });
      } catch (e) { return send(500, { error: (e as Error).message }); }
    })();
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, port, url: `http://${host}:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
