// Browser/host client for the Starfish sidecar. Self-contained (no @starfish/governance-core import) so
// the engine never enters the dashboard bundle. Fail-soft reads; approvals use the per-actor token.
export const WIRE = 1;
export interface PendingItem { id: string; tool: string; actor: string; target?: string; reason?: string; riskTier?: string }
export interface BudgetItem { scope: string; status: string; usd: number; usdLimit: number }
export interface MonitorView { counters: { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number }; safeMode: boolean }
export interface UiBridge {
  health(): Promise<{ ok: boolean; wire: number }>;
  pending(): Promise<PendingItem[]>;
  audit(): Promise<unknown[]>;
  budgets(): Promise<BudgetItem[]>;
  monitor(): Promise<MonitorView>;
  resolve(id: string, verdict: 'approve' | 'deny', by: string): Promise<{ ok: boolean; reason: string }>;
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
  };
}
