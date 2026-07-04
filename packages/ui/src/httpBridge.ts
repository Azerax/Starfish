// Browser/host client for the Starfish sidecar. Self-contained (no @starfish/governance-core import) so
// the engine never enters the dashboard bundle. Fail-soft reads; approvals use the per-actor token.
export const WIRE = 1;
export interface PendingItem { id: string; tool: string; actor: string; target?: string; reason?: string; riskTier?: string }
export interface BudgetItem { scope: string; status: string; usd: number; usdLimit: number }
export interface MonitorView { counters: { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number }; safeMode: boolean }
export interface StreamEvent { type: string; data: unknown }
export interface UiBridge {
  health(): Promise<{ ok: boolean; wire: number }>;
  pending(): Promise<PendingItem[]>;
  audit(): Promise<unknown[]>;
  budgets(): Promise<BudgetItem[]>;
  monitor(): Promise<MonitorView>;
  resolve(id: string, verdict: 'approve' | 'deny', by: string): Promise<{ ok: boolean; reason: string }>;
  /** Live push subscription (SSE over fetch — the token stays in the Authorization header, never a query
   *  string). Auto-reconnects with exponential backoff. Returns an unsubscribe function. */
  subscribe(handler: (ev: StreamEvent) => void, by?: string): () => void;
}

export function httpBridge(opts: { url: string; tokens: Record<string, string> }): UiBridge {
  const anyTok = (): string => opts.tokens.operator ?? opts.tokens.worker ?? Object.values(opts.tokens)[0] ?? '';
  const get = async (path: string, token = anyTok()): Promise<unknown> => {
    const r = await fetch(opts.url + path, { headers: { 'x-starfish-wire': String(WIRE), authorization: `Bearer ${token}` } });
    return r.ok ? r.json() : (r.status === 200 ? {} : Promise.reject(new Error(`sidecar ${r.status}`)));
  };
  return {
    async health() { const r = await fetch(opts.url + '/v1/health'); return r.json() as Promise<{ ok: boolean; wire: number }>; },
    async pending() { try { return (await get('/v1/pending')) as PendingItem[]; } catch { return []; } },
    async audit() { try { return (await get('/v1/audit')) as unknown[]; } catch { return []; } },
    async budgets() { try { return (await get('/v1/budgets')) as BudgetItem[]; } catch { return []; } },
    async monitor() { try { return (await get('/v1/monitor')) as MonitorView; } catch { return { counters: { denials: 0, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 0, orphanPosts: 0, casualties: 0 }, safeMode: false }; } },
    async resolve(id, verdict, by) {
      try {
        const r = await fetch(opts.url + `/v1/decisions/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-starfish-wire': String(WIRE), authorization: `Bearer ${opts.tokens[by] ?? anyTok()}` }, body: JSON.stringify({ verdict }) });
        const j = (await r.json()) as { ok?: boolean; reason?: string };
        return { ok: !!j.ok, reason: String(j.reason ?? '') };
      } catch { return { ok: false, reason: 'fail-closed: sidecar unreachable' }; }
    },
    subscribe(handler, by = 'operator') {
      let closed = false; let backoff = 500;
      const run = async (): Promise<void> => {
        while (!closed) {
          try {
            const resp = await fetch(opts.url + '/v1/stream', { headers: { 'x-starfish-wire': String(WIRE), authorization: `Bearer ${opts.tokens[by] ?? anyTok()}` } });
            if (!resp.ok || !resp.body) throw new Error('stream ' + resp.status);
            backoff = 500;
            const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
            const dec = new TextDecoder(); let buf = '';
            while (!closed) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let idx: number;
              while ((idx = buf.indexOf('\n\n')) >= 0) {
                const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
                let type = 'message'; const dataLines: string[] = [];
                for (const line of chunk.split('\n')) {
                  if (line.startsWith('event:')) type = line.slice(6).trim();
                  else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                  // lines starting with ':' are keep-alive comments — ignored
                }
                if (dataLines.length) {
                  let data: unknown; const raw = dataLines.join('\n');
                  try { data = JSON.parse(raw); } catch { data = raw; }
                  try { handler({ type, data }); } catch { /* handler error must not kill the stream */ }
                }
              }
            }
            try { reader.releaseLock(); } catch { /* noop */ }
          } catch { /* fall through to backoff + reconnect */ }
          if (closed) break;
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 10000);
        }
      };
      void run();
      return () => { closed = true; };
    },
  };
}
