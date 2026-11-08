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
          <div className="sf-what"><b>{p.actor}</b> {p.tool} {p.target ?? ''}{p.confirmation === 'deliberate' ? <span className="sf-deliberate"> · needs typed confirmation</span> : null}<div className="sf-reason">{p.reason ?? ''}</div></div>
          <div className="sf-acts">
            <button type="button" onClick={() => onResolve(p.id, 'approve')}>Approve</button>
            <button type="button" onClick={() => onResolve(p.id, 'deny')}>Deny</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** H6: approving a deliberate item is a separate act from a routine click. The person types the tool
 *  label; Approve stays disabled until it matches. The sidecar checks the same value, so a UI that
 *  skipped this step would be refused there, not silently obeyed. */
export function DeliberateConfirm({ item, onConfirm, onCancel }: { item: PendingItem; onConfirm: (typed: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  const match = typed === item.tool;
  return (
    <div className="sf-confirm" role="dialog" aria-modal="true" aria-labelledby="sf-confirm-title">
      <p id="sf-confirm-title"><b>This approval needs a deliberate confirmation.</b></p>
      <p>{item.actor} wants to run <b>{item.tool}</b>{item.target ? <> on <code>{item.target}</code></> : null}. {item.askOrigin === 'floor' ? 'A floor category requires a person.' : `Risk tier: ${item.riskTier ?? 'unclassified'}.`}</p>
      <label>Type <code>{item.tool}</code> to approve <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="confirmation" /></label>
      <div className="sf-acts">
        <button type="button" disabled={!match} onClick={() => onConfirm(typed)}>Approve</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function GovernancePanel({ bridge, theme = 'calm', operatorActor = 'operator', pollMs = 3000 }: { bridge: UiBridge; theme?: ThemeId; operatorActor?: string; pollMs?: number }) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [mon, setMon] = useState<MonitorView | null>(null);
  const [confirming, setConfirming] = useState<PendingItem | null>(null);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => { try { const [p, m] = await Promise.all([bridge.pending(), bridge.monitor()]); if (live) { setItems(p); setMon(m); } } catch { /* fail-soft */ } };
    void load(); const id = setInterval(() => void load(), pollMs);
    return () => { live = false; clearInterval(id); };
  }, [bridge, pollMs]);
  // Live push (SSE): apply pending/monitor events the moment they arrive; the poll above stays only as a
  // fail-soft backstop if the stream drops.
  useEffect(() => {
    const unsub = bridge.subscribe((ev) => {
      if (ev.type === 'pending' && Array.isArray(ev.data)) setItems(ev.data as PendingItem[]);
      else if (ev.type === 'monitor' && ev.data && typeof ev.data === 'object') setMon(ev.data as MonitorView);
    }, operatorActor);
    return unsub;
  }, [bridge, operatorActor]);
  const send = async (id: string, verdict: 'approve' | 'deny', confirm?: string): Promise<void> => {
    const r = await bridge.resolve(id, verdict, operatorActor, confirm);
    // Only drop the item when the sidecar accepted the answer; a refused approval stays visible.
    if (r.ok) setItems((cur) => cur.filter((x) => x.id !== id));
  };
  const onResolve = async (id: string, verdict: 'approve' | 'deny'): Promise<void> => {
    const item = items.find((x) => x.id === id);
    if (verdict === 'approve' && item?.confirmation === 'deliberate') { setConfirming(item); return; }
    await send(id, verdict);
  };
  const def = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const Chosen = def.Component;
  return (
    <>
      <Chosen items={items} monitor={mon} onResolve={onResolve} />
      {confirming ? <DeliberateConfirm item={confirming} onCancel={() => setConfirming(null)} onConfirm={(typed) => { const id = confirming.id; setConfirming(null); void send(id, 'approve', typed); }} /> : null}
    </>
  );
}
