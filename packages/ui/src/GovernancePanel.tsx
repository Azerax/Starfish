import { useEffect, useState } from 'react';
import type { UiBridge, PendingItem, MonitorView } from './httpBridge';

// Pure, props-driven list (SSR/test-friendly; no effects). Escapes all governance strings by default.
export function PendingList({ items, onResolve }: { items: PendingItem[]; onResolve: (id: string, verdict: 'approve' | 'deny') => void }) {
  if (items.length === 0) return <p className="sf-empty">Nothing awaiting you.</p>;
  return (
    <ul className="sf-pending">
      {items.map((p) => (
        <li key={p.id} className="sf-item">
          <div className="sf-what"><b>{p.actor}</b> {p.tool} {p.target ?? ''}<div className="sf-reason">{p.reason ?? ''}</div></div>
          <div className="sf-acts">
            <button type="button" onClick={() => onResolve(p.id, 'approve')}>Approve</button>
            <button type="button" onClick={() => onResolve(p.id, 'deny')}>Deny</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Stateful wrapper: polls the sidecar and drives approvals. Drop into any host dashboard.
export function GovernancePanel({ bridge, operatorActor = 'operator', pollMs = 3000 }: { bridge: UiBridge; operatorActor?: string; pollMs?: number }) {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [mon, setMon] = useState<MonitorView | null>(null);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => { try { const [p, m] = await Promise.all([bridge.pending(), bridge.monitor()]); if (live) { setPending(p); setMon(m); } } catch { /* fail-soft */ } };
    void load(); const id = setInterval(() => void load(), pollMs);
    return () => { live = false; clearInterval(id); };
  }, [bridge, pollMs]);
  const resolve = async (id: string, verdict: 'approve' | 'deny'): Promise<void> => { await bridge.resolve(id, verdict, operatorActor); setPending((cur) => cur.filter((x) => x.id !== id)); };
  const anomalies = mon ? mon.counters.boundaryEscapes + mon.counters.hashMismatches + mon.counters.budgetHard + mon.counters.orphanPosts : 0;
  return (
    <div className="sf-gov">
      <h3>Needs your go / no-go ({pending.length})</h3>
      <PendingList items={pending} onResolve={resolve} />
      {mon && <div className="sf-monitor">{mon.safeMode ? 'SAFE MODE - ' : ''}denials {mon.counters.denials} · anomalies {anomalies}</div>}
    </div>
  );
}
