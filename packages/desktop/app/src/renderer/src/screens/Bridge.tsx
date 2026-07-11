import { useEffect, useMemo, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { CrewMemberView, DecisionLogEntry, BudgetView, MonitorView, AgentDetailView } from '../bridge/types';
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/themes';

const RISK_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

// D5 "Split Cockpit": the risk-sorted approval queue is the hero (left); the selected decision's full
// context (actor, tool, target, reason, and the actor's governed posture) fills the right pane so you
// can never rubber-stamp. Crew / budgets / monitor / live feed are secondary, below.
export function Bridge({ nameFor }: { nameFor: (t: Theme, id: string) => string }) {
  const bridge = getBridge();
  const { theme } = useTheme();
  const [crew, setCrew] = useState<CrewMemberView[]>([]);
  const [decisions, setDecisions] = useState<DecisionLogEntry[]>([]);
  const [budgets, setBudgets] = useState<BudgetView[]>([]);
  const [monitor, setMonitor] = useState<MonitorView | null>(null);
  const [resumed, setResumed] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<Record<string, 'allow' | 'deny'>>({});
  const [pending, setPending] = useState<DecisionLogEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetailView | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const load = () => {
      void bridge.getCrew().then(setCrew);
      void bridge.getDecisions(14).then(setDecisions);
      void bridge.getBudgets().then(setBudgets);
      void bridge.getMonitor().then(setMonitor);
    };
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [bridge]);

  // Stable, risk-sorted pending queue (asks that await you); items never reshuffle under the live feed.
  useEffect(() => {
    setPending((cur) => {
      const have = new Set(cur.map((d) => d.id));
      const fresh = decisions.filter((d) => d.verdict === 'ask' && !have.has(d.id) && !resolved[d.id]);
      const kept = cur.filter((d) => !resolved[d.id]);
      return [...kept, ...fresh]
        .sort((a, b) => (RISK_RANK[b.riskTier ?? 'low'] ?? 0) - (RISK_RANK[a.riskTier ?? 'low'] ?? 0))
        .slice(0, 20);
    });
  }, [decisions, resolved]);

  // Auto-select the top of the queue; load the acting agent's governed posture for the context pane.
  useEffect(() => { if (!selected && pending.length) setSelected(pending[0].id); }, [pending, selected]);
  const sel = useMemo(() => pending.find((d) => d.id === selected) ?? null, [pending, selected]);
  useEffect(() => {
    setNote('');
    if (!sel) { setDetail(null); return; }
    let live = true;
    void bridge.getAgentDetail(sel.actor).then((d) => { if (live) setDetail(d); }).catch(() => {});
    return () => { live = false; };
  }, [bridge, sel]);

  async function resume(id: string) {
    setResumed((m) => ({ ...m, [id]: true }));
    await bridge.requestAction({ actor: 'operator', intent: { kind: 'resume', agentId: id } });
  }
  async function resolve(id: string, approve: boolean) {
    setResolved((m) => ({ ...m, [id]: approve ? 'allow' : 'deny' }));
    setPending((cur) => cur.filter((d) => d.id !== id));
    setSelected((s) => (s === id ? null : s));
    await bridge.requestAction({ actor: 'operator', intent: { kind: approve ? 'approve' : 'deny', decisionId: id, note } });
  }

  const highCount = pending.filter((d) => d.riskTier === 'high' || d.riskTier === 'critical').length;
  const statusOf = (c: CrewMemberView) => (resumed[c.id] ? 'active' : c.status);
  const chip = (d: { riskTier?: string; descriptor?: string; score?: number }) =>
    <span className={`riskchip ${d.riskTier ?? 'low'}`} title={`risk ${d.score ?? '—'}/100`}>{d.descriptor ?? d.riskTier ?? 'low'}{d.score != null ? ` · ${d.score}` : ''}</span>;

  return (
    <main className="bridge">
      <div className="cockpit">
        {/* LEFT — risk-sorted approval queue (the hero) */}
        <div>
          <div className="col-head"><span>Needs your go / no-go</span><span>{pending.length} pending · {highCount} high</span></div>
          {pending.length === 0 ? (
            <div className="empty">Nothing awaiting you. New approvals appear here, risk-sorted, and hold still.</div>
          ) : (
            <div className="qcol">
              {pending.map((d) => (
                <button key={d.id} className={`qitem${selected === d.id ? ' sel' : ''}`} onClick={() => setSelected(d.id)}>
                  <div className="qtop">{chip(d)}<span className="qtool">{d.tool}</span></div>
                  <div className="qactor">{nameFor(theme, d.actor)}</div>
                  {d.target && <div className="qtarget">{d.target}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — full decision context; no rubber-stamping */}
        <section className="ctxpane">
          {!sel ? (
            <div className="ctx-empty"><div style={{ fontSize: 15 }}>Select an item to review it</div><div style={{ fontSize: 13 }}>You'll see who, what, where, why, the risk, and the agent's boundary before you decide.</div></div>
          ) : (
            <>
              <div className="ctxhead">{chip(sel)}<div className="ctxtitle">{nameFor(theme, sel.actor)} wants to <span className="mono">{sel.tool}</span></div></div>
              <table className="ctxmeta"><tbody>
                {sel.target && <tr><td>target</td><td className="mono" style={{ color: 'var(--accent)' }}>{sel.target}</td></tr>}
                <tr><td>requested</td><td className="mono">{sel.ts}</td></tr>
                {detail?.domain && <tr><td>agent role</td><td>{detail.role} · {detail.domain}</td></tr>}
              </tbody></table>

              <div className="ctxlabel">why this needs you</div>
              <div className="ctxreason">{sel.reason}</div>

              {detail && (
                <>
                  <div className="ctxlabel">agent boundary</div>
                  <table className="ctxmeta"><tbody>
                    <tr><td>visibility</td><td className="mono">{detail.boundary.visibility.join(', ') || '—'}</td></tr>
                    <tr><td>write</td><td className="mono">{detail.boundary.write.join(', ') || 'none (read-only)'}</td></tr>
                  </tbody></table>
                  <div className="ctxlabel">allowed capabilities <span style={{ textTransform: 'none', letterSpacing: 0 }}>· deny-by-default otherwise</span></div>
                  {detail.allowedTools.length === 0 ? <div className="empty">None — cannot invoke tools directly.</div> :
                    <div className="chips">{detail.allowedTools.map((t) => <span className="chip" key={t}>{t}</span>)}</div>}
                </>
              )}

              <input className="ctx-note" placeholder="Add a reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="ctxacts">
                <button className="act deny" onClick={() => resolve(sel.id, false)}>Deny</button>
                <button className="act approve" onClick={() => resolve(sel.id, true)}>Approve</button>
              </div>
            </>
          )}
        </section>
      </div>

      {/* SECONDARY — crew, budgets, monitor, live feed */}
      <div className="secondary">
        <section className="card">
          <h3>Crew <span className="src">{crew.filter((c) => statusOf(c) !== 'paused').length}/{crew.length} active</span></h3>
          <div className="feed">
            {crew.map((c) => (
              <div key={c.id} className="dec" style={{ borderLeftColor: 'var(--line)' }}>
                <span className={`tag ${statusOf(c)}`}><i className="led" /> {statusOf(c)}</span>
                <div className="what"><b>{nameFor(theme, c.id)}</b> <span className="muted">{c.role}</span>
                  {c.currentTaskId && <div className="reason">{c.currentTaskId}</div>}</div>
                {statusOf(c) === 'paused' && <button className="act resume" onClick={() => void resume(c.id)}>Resume</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>Token Governor <span className="src">budgets</span></h3>
          {budgets.map((b) => (
            <div key={b.scope}>
              {b.usdLimit > 0 ? (<>
                <div className="kv"><span>{b.scope}</span><b>${b.usdUsed.toFixed(2)} / ${b.usdLimit.toFixed(2)}</b></div>
                <div className="meter"><i style={{ width: `${Math.min(100, (b.usdUsed / b.usdLimit) * 100)}%`, background: b.status === 'hard' ? 'var(--deny)' : 'var(--ok)' }} /></div>
              </>) : (
                <div className="kv"><span>{b.scope}</span><b>${b.usdUsed.toFixed(2)} · <span style={{ color: 'var(--ok)' }}>platform</span></b></div>
              )}
            </div>
          ))}
          {monitor && (
            <div className="govmini">
              <div className="kv"><span>Denials this sweep</span><b>{monitor.counters.denials}</b></div>
              <div className="kv"><span>Boundary / hash alerts</span><b>{monitor.counters.boundaryEscapes} / {monitor.counters.hashMismatches}</b></div>
              <div className="kv"><span>Last sweep</span><b className="mono">{monitor.lastSweepTs}</b></div>
            </div>
          )}
        </section>

        {monitor && (
          <section className="card span2">
            <div className={`ribbon ${monitor.reconciled ? 'ok' : 'bad'}`}>
              {monitor.reconciled ? 'Watcher reconciled against deterministic counters.' : 'Anomalies detected (boundary / hash / budget / orphan) — investigate.'} Last sweep {monitor.lastSweepTs}.
            </div>
          </section>
        )}

        <section className="card span2">
          <h3 className="collapse" onClick={() => setFeedOpen((o) => !o)}>
            <span className="chev">{feedOpen ? '▾' : '▸'}</span> Live governance decisions <span className="src">PDP · {decisions.length} recent</span>
          </h3>
          {feedOpen && (
            <div className="feed scrolly">
              {decisions.map((d) => {
                const ov = resolved[d.id];
                const verdict = ov ?? d.verdict;
                return (
                  <div className={`dec ${verdict}`} key={d.id}>
                    <span className="verdict">{verdict.toUpperCase()}</span>
                    <div className="what"><b>{nameFor(theme, d.actor)}</b> · {d.tool} {d.target ?? ''}
                      <div className="reason">{ov ? (ov === 'allow' ? 'approved by operator' : 'denied by operator') : d.reason}</div></div>
                    <span className="t">{d.ts}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
