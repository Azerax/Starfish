// Loopback sidecar: the governed decision + approval API over HTTP for any-language host skills. Security
// by construction: 127.0.0.1 only, Host-header check, bearer-token auth, wire-version handshake,
// body-size cap, server-assigned actor identity + strict input allowlist so proposer != approver holds.
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { Governance } from './index';

export const WIRE_VERSION = 1;
export const MAX_BODY_BYTES = 256 * 1024;
const RISK_TIERS = ['low', 'medium', 'high', 'critical'];
export interface SidecarIdentity { token: string; actor: string }
export interface SidecarOptions { governance: Governance; identities: SidecarIdentity[]; host?: string; port?: number }
export interface Sidecar { server: Server; port: number; url: string; close(): Promise<void> }

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

export async function startSidecar(opts: SidecarOptions): Promise<Sidecar> {
  const host = opts.host ?? '127.0.0.1';
  const gov = opts.governance;
  let boundPort = 0;
  const identify = (req: IncomingMessage): SidecarIdentity | null => {
    const h = String(req.headers['authorization'] ?? '');
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return null;
    return opts.identities.find((i) => tokenEq(i.token, tok)) ?? null;
  };
  const hostOk = (req: IncomingMessage): boolean => {
    const hh = String(req.headers['host'] ?? '');
    if (!hh) return true;
    const hn = hh.replace(/^\[/, '').split(/[:\]]/)[0];
    return hn === '127.0.0.1' || hn === 'localhost' || hn === '::1';
  };

  const resolved = new Map<string, 'approve' | 'deny'>();
  const server = createServer((req, res) => {
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

        const id = identify(req);
        if (!id) return send(401, { error: 'invalid or missing token' });

        const { body, tooLarge } = await readJson(req);
        if (tooLarge) return send(413, { error: 'request body too large' });

        if (method === 'POST' && url === '/v1/decide') {
          return send(200, gov.governCall(body.call as never, body.boundary as never));
        }
        if (method === 'POST' && url === '/v1/decisions') {
          const raw = (body.decision ?? {}) as Record<string, unknown>;   // strict allowlist; server owns actor/kind/refId (audit A6)
          const dec = {
            actor: id.actor,
            kind: 'tool',
            tool: str(raw.tool, 120) ?? 'unknown',
            target: str(raw.target, 1024),
            reason: str(raw.reason, 2000) ?? '',
            riskTier: RISK_TIERS.includes(String(raw.riskTier)) ? String(raw.riskTier) : 'high',
            refId: id.actor + ':' + (str(raw.refId, 120) ?? randomUUID()),
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
          const v = resolved.get(decId);
          return send(200, { status: v === 'approve' ? 'approved' : v === 'deny' ? 'denied' : 'unknown' });
        }
        if (method === 'POST' && url.startsWith('/v1/decisions/')) {
          const decId = decodeURIComponent(url.slice('/v1/decisions/'.length));
          const verdict = body.verdict === 'deny' ? 'deny' : 'approve';
          const r = gov.broker.resolve(decId, verdict, id.actor);
          if (r.ok) resolved.set(decId, verdict);
          return send(r.ok ? 200 : 409, { ok: r.ok, reason: r.reason });
        }
        return send(404, { error: 'not found' });
      } catch (e) { return send(500, { error: (e as Error).message }); }
    })();
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, () => resolve()));
  const addr = server.address();
  boundPort = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, port: boundPort, url: `http://${host}:${boundPort}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
