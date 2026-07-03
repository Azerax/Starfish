// HTTP client for the loopback sidecar + a ModeRunner so the SAME conformance pack runs over HTTP.
// Fail-closed: any transport error becomes a deny.
import { WIRE_VERSION } from './serve';
import type { ModeRunner } from './conformance/runner';

export interface SidecarClientOptions { url: string; tokens: Record<string, string>; close?: () => Promise<void> }

export function makeSidecarRunner(opts: SidecarClientOptions): ModeRunner {
  const anyToken = (): string => opts.tokens.worker ?? Object.values(opts.tokens)[0] ?? '';
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
    const res = await fetch(opts.url + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-starfish-wire': String(WIRE_VERSION), authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try { json = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
    return { status: res.status, json };
  };

  return {
    name: 'sidecar',
    async decide(c, boundary) {
      try {
        const r = await call('POST', '/v1/decide', anyToken(), { call: c, boundary });
        if (r.status !== 200) return { allow: false, ask: false, reason: `sidecar ${r.status}` };
        return { allow: !!r.json.allow, ask: !!r.json.ask, reason: String(r.json.reason ?? '') };
      } catch { return { allow: false, ask: false, reason: 'fail-closed: sidecar unreachable' }; }
    },
    async file(dec) {
      const actor = String((dec as { actor?: string }).actor ?? 'worker');
      const r = await call('POST', '/v1/decisions', opts.tokens[actor] ?? anyToken(), { decision: dec });
      return { id: String(r.json.id ?? '') };
    },
    async pending() {
      try {
        const r = await call('GET', '/v1/pending', anyToken());
        return Array.isArray(r.json) ? (r.json as unknown as Array<{ id: string; tool: string; actor: string }>) : [];
      } catch { return []; }
    },
    async resolve(id, verdict, by) {
      try {
        const r = await call('POST', `/v1/decisions/${encodeURIComponent(id)}`, opts.tokens[by] ?? anyToken(), { verdict });
        return { ok: !!r.json.ok, reason: String(r.json.reason ?? '') };
      } catch { return { ok: false, reason: 'fail-closed: sidecar unreachable' }; }
    },
    async down() { if (opts.close) await opts.close(); },
  };
}
