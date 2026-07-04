import { useEffect, useState } from 'react';
import type { UiBridge, PendingItem, MonitorView } from './httpBridge';
import { THEMES } from './themes';
import type { ThemeId } from './themes/types';

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

export function GovernancePanel({ bridge, theme = 'calm', operatorActor = 'operator', pollMs = 3000 }: { bridge: UiBridge; theme?: ThemeId; operatorActor?: string; pollMs?: number }) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [mon, setMon] = useState<MonitorView | null>(null);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => { try { const [p, m] = await Promise.all([bridge.pending(), bridge.monitor()]); if (live) { setItems(p); setMon(m); } } catch { /* fail-soft */ } };
    void load(); const id = setInterval(() => void load(), pollMs);
    return () => { live = false; clearInterval(id); };
  }, [bridge, pollMs]);
  const onResolve = async (id: string, verdict: 'approve' | 'deny'): Promise<void> => { await bridge.resolve(id, verdict, operatorActor); setItems((cur) => cur.filter((x) => x.id !== id)); };
  const def = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const Chosen = def.Component;
  return <Chosen items={items} monitor={mon} onResolve={onResolve} />;
}
