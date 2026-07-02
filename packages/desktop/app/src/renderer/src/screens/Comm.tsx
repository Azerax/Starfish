import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { ActionResult, DecisionLogEntry } from '../bridge/types';

// COMM — Communications: the operator issues an order/mission. Every order is GOVERNED — the PDP
// adjudicates it (proposer != approver), so elevated orders come back "awaiting approval", not auto-run.
interface Order { id: number; text: string; result: ActionResult; ts: string }

export function Comm({ onBack }: { onBack: () => void }) {
  const bridge = getBridge();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Order[]>([]);
  const [pending, setPending] = useState<DecisionLogEntry[]>([]);   // asks parked mid-run, awaiting you

  async function issue() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const result = await bridge.requestAction({ actor: 'operator', intent: { kind: 'mission', text: t } });
    setLog((l) => [{ id: Date.now(), text: t, result, ts: new Date().toTimeString().slice(0, 8) }, ...l]);
    setText(''); setBusy(false);
  }

  // While an order is in flight, watch for approval asks it parks on the broker so we can tell the
  // operator the agent is PAUSED (awaiting them), not stuck — and let them resolve it right here.
  useEffect(() => {
    if (!busy) { setPending([]); return; }
    let live = true;
    const poll = async () => {
      try {
        const ds = await bridge.getDecisions(30);
        if (!live) return;
        setPending(ds.filter((d) => d.verdict === 'ask' && !String(d.tool || '').startsWith('capability')));
      } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, 1500);
    return () => { live = false; clearInterval(id); };
  }, [busy, bridge]);

  async function resolvePending(id: string, approve: boolean) {
    setPending((cur) => cur.filter((d) => d.id !== id));   // optimistic
    await bridge.requestAction({ actor: 'operator', intent: { kind: approve ? 'approve' : 'deny', decisionId: id } });
  }

  const verdict = (r: ActionResult) => (r.decision.allow ? 'dispatched' : r.decision.ask ? 'awaiting approval' : 'denied');
  const tier = (r: ActionResult) => (r.decision.allow ? 'low' : r.decision.ask ? 'medium' : 'critical');
  const awaiting = busy && pending.length > 0;

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
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void issue(); }} disabled={busy} />
        </div>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void issue()}>{awaiting ? 'Awaiting your approval…' : busy ? 'Routing…' : 'Issue order'}</button>

        {busy && (
          <div style={{ marginTop: 16, border: `1px solid ${awaiting ? 'var(--ask, #e8b64c)' : 'var(--line, #24304a)'}`, borderRadius: 10, padding: '12px 14px', background: 'var(--chip, #0e1626)' }}>
            {!awaiting ? (
              <div style={{ color: 'var(--muted, #9aa8c4)', fontSize: 13 }}>⏳ Routing to the model and executing under governance… the agent is working, this can take a few seconds.</div>
            ) : (
              <>
                <div style={{ fontWeight: 600, color: 'var(--ask, #e8b64c)', marginBottom: 8 }}>⏸ Paused for your go/no-go — the agent is <b>not stuck</b>. It proposed an action that needs your approval to continue:</div>
                {pending.map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--line, #24304a)', paddingTop: 10, marginTop: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{d.tool} <span style={{ color: 'var(--muted, #9aa8c4)', fontWeight: 400 }}>{d.target ?? ''}</span></div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted, #9aa8c4)' }}>{d.reason}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button className="btn primary" onClick={() => void resolvePending(d.id, true)}>Approve</button>
                      <button className="btn" onClick={() => void resolvePending(d.id, false)}>Deny</button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: 'var(--muted, #9aa8c4)', marginTop: 10 }}>You can also approve this from the Bridge under "Needs your go / no-go".</div>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          {log.length === 0 && !busy && <p className="wsub">Orders are governed: each is adjudicated by the PDP and recorded to the audit log. Elevated actions require your approval.</p>}
          {log.map((o) => (
            <div key={o.id} style={{ border: '1px solid var(--line, #24304a)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div className="nm" style={{ fontWeight: 600 }}>{o.text}</div>
                <span className={`risk ${tier(o.result)}`}>{verdict(o.result)}</span>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '10px 0 0', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, lineHeight: 1.5, color: o.result.decision.allow ? 'var(--fg, #cdd7ea)' : 'var(--deny, #ff7a73)', maxHeight: 320, overflow: 'auto' }}>{o.result.decision.reason || '(no response)'}</pre>
              <div className="meta" style={{ marginTop: 6, opacity: 0.6 }}>{o.ts}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="wfoot"><button className="btn" onClick={onBack}>Back to Bridge</button></div>
    </div></div>
  );
}
