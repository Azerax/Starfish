import { useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { ActionResult } from '../bridge/types';

// COMM — Communications: the operator issues an order/mission. Every order is GOVERNED — the PDP
// adjudicates it (proposer != approver), so elevated orders come back "awaiting approval", not auto-run.
interface Order { id: number; text: string; result: ActionResult; ts: string }

export function Comm({ onBack }: { onBack: () => void }) {
  const bridge = getBridge();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Order[]>([]);

  async function issue() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const result = await bridge.requestAction({ actor: 'operator', intent: { kind: 'mission', text: t } });
    setLog((l) => [{ id: Date.now(), text: t, result, ts: new Date().toTimeString().slice(0, 8) }, ...l]);
    setText(''); setBusy(false);
  }

  const verdict = (r: ActionResult) => (r.decision.allow ? 'dispatched' : r.decision.ask ? 'awaiting approval' : 'denied');
  const tier = (r: ActionResult) => (r.decision.allow ? 'low' : r.decision.ask ? 'medium' : 'critical');

  return (
    <div className="wizwrap"><div className="wiz">
      <div className="head">
        <div className="ti">COMM<small>Communications · issue orders</small></div>
        <span className="govpill">● proposer ≠ approver</span>
      </div>
      <div className="wbody">
        <div className="field">
          <label className="lbl">Order / mission</label>
          <input type="text" value={text} placeholder="e.g. Draft a Q3 summary from /proj/reports"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void issue(); }} />
        </div>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void issue()}>{busy ? 'Routing…' : 'Issue order'}</button>
        <div style={{ marginTop: 18 }}>
          {log.length === 0 && <p className="wsub">Orders are governed: each is adjudicated by the PDP and recorded to the audit log. Elevated actions require your approval.</p>}
          {log.map((o) => (
            <div className="caprow" key={o.id}>
              <div><div className="nm">{o.text}</div><div className="meta">{o.ts} · {o.result.decision.reason}</div></div>
              <span className={`risk ${tier(o.result)}`}>{verdict(o.result)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="wfoot"><button className="btn" onClick={onBack}>Back to Bridge</button></div>
    </div></div>
  );
}
