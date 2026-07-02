import { useEffect, useMemo, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { CrewMemberView, DecisionLogEntry, BudgetView, MonitorView, AgentDetailView } from '../bridge/types';
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/themes';
import { CrewAvatar } from '../theme/icons';

export function Bridge({ nameFor }: { nameFor: (t: Theme, id: string) => string }) {
  const bridge = getBridge();
  const { theme } = useTheme();
  const [crew, setCrew] = useState<CrewMemberView[]>([]);
  const [decisions, setDecisions] = useState<DecisionLogEntry[]>([]);
  const [budgets, setBudgets] = useState<BudgetView[]>([]);
  const [monitor, setMonitor] = useState<MonitorView | null>(null);
  const [resumed, setResumed] = useState<Record<string, boolean>>({});            // operator resumed
  const [resolved, setResolved] = useState<Record<string, 'allow' | 'deny'>>({});  // operator decided
  const [pending, setPending] = useState<DecisionLogEntry[]>([]);                  // STABLE queue of asks awaiting you
  const [feedOpen, setFeedOpen] = useState(false);                                 // live log collapsed by default
  const [selected, setSelected] = useState<string | null>(null);                  // crew detail drawer
  const [detail, setDetail] = useState<AgentDetailView | null>(null);

  useEffect(() => {
    const load = () => {
      void bridge.getCrew().then(setCrew);
      void bridge.getDecisions(12).then(setDecisions);
      void bridge.getBudgets().then(setBudgets);
      void bridge.getMonitor().then(setMonitor);
    };
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [bridge]);

  // Accumulate ASK decisions into a STABLE pending queue so the items you must act on never reshuffle
  // under the live feed. New asks append to the bottom; resolved ones drop out.
  useEffect(() => {
    setPending((cur) => {
      const have = new Set(cur.map((d) => d.id));
      const fresh = decisions.filter((d) => d.verdict === 'ask' && !have.has(d.id) && !resolved[d.id]);
      const kept = cur.filter((d) => !resolved[d.id]);
      return [...kept, ...fresh].slice(0, 12);
    });
  }, [decisions, resolved]);

  // Load the detail drawer when a crew member is selected
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let live = true;
    void bridge.getAgentDetail(selected).then((d) => { if (live) setDetail(d); });
    return () => { live = false; };
  }, [bridge, selected]);

  async function resume(id: string) {
    setResumed((m) => ({ ...m, [id]: true }));   // optimistic
    await bridge.requestAction({ actor: 'operator', intent: { kind: 'resume', agentId: id } });
  }
  async function resolve(id: string, approve: boolean) {
    setResolved((m) => ({ ...m, [id]: approve ? 'allow' : 'deny' }));
    setPending((cur) => cur.filter((d) => d.id !== id));   // clear from the queue immediately
    await bridge.requestAction({ actor: 'operator', intent: { kind: approve ? 'approve' : 'deny', decisionId: id } });
  }

  const activeCount = crew.filter((c) => (resumed[c.id] ? true : c.status !== 'paused')).length;
  const pendingCount = pending.length;
  const captainId = crew.find((c) => c.id === 'michael') ? 'michael' : crew[0]?.id;
  const statusOf = (c: CrewMemberView) => (resumed[c.id] ? 'active' : c.status);

  const drawerCrew = useMemo(() => crew.find((c) => c.id === selected) || null, [crew, selected]);

  return (
    <main className="grid">
      <section className="card span2">
        <h3>Crew <span className="src">live · {activeCount}/{crew.length} active</span></h3>
        <div className="crew">
          {crew.map((c) => {
            const status = statusOf(c);
            const isCaptain = c.id === captainId;
            return (
              <button className={`c card-btn${selected === c.id ? ' sel' : ''}`} key={c.id} onClick={() => setSelected(c.id)} title="View boundary & allowlist">
                <div className="avatar"><CrewAvatar id={c.id} /></div>
                <div style={{ flex: 1 }}>
                  <div className="nm">{nameFor(theme, c.id)}
                    {isCaptain && pendingCount > 0 && <span className="badge" title="Decisions awaiting your go / no-go">⚑ {pendingCount} Orders Pending</span>}
                  </div>
                  <div className="role">{c.role}</div>
                  <div className="st">
                    <span className={`tag ${status}`}><i className="led" /> {status}</span>
                    {c.currentTaskId && <span className="muted">{c.currentTaskId}</span>}
                    <span className={`risk-${c.riskTier}`} title="Authority tier: how much governance scrutiny this crew role gets">clearance: {c.riskTier}</span>
                  </div>
                </div>
                {status === 'paused' && <span className="act resume" onClick={(e) => { e.stopPropagation(); void resume(c.id); }}>Resume</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* Action queue — STABLE; these are the only items you must touch, and they never reshuffle. */}
      <section className="card">
        <h3>Needs your go / no-go <span className="src">{pendingCount} pending</span></h3>
        {pendingCount === 0 ? (
          <div className="empty">✓ Nothing awaiting you. New approvals will appear here and hold still.</div>
        ) : (
          <div className="queue">
            {pending.map((d) => (
              <div className="qrow" key={d.id}>
                <div className="what">
                  <b>{nameFor(theme, d.actor)}</b> · {d.tool} {d.target ?? ''}
                  <div className="reason">{d.reason}</div>
                </div>
                <div className="acts">
                  <button className="act approve" onClick={() => resolve(d.id, true)}>Approve</button>
                  <button className="act deny" onClick={() => resolve(d.id, false)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Token Governor <span className="src">live · budgets</span></h3>
        {budgets.map((b) => (
          <div key={b.scope} className="budget">
            {b.usdLimit > 0 ? (
              <>
                <div className="kv"><span>{b.scope} (USD)</span><b>${b.usdUsed.toFixed(2)} / ${b.usdLimit.toFixed(2)}</b></div>
                <div className="meter"><i style={{ width: `${Math.min(100, (b.usdUsed / b.usdLimit) * 100)}%`, background: b.status === 'hard' ? 'var(--deny)' : 'linear-gradient(90deg,var(--ok),var(--warn))' }} /></div>
                {b.status === 'hard' && <div className="warn">hard cap - paused (resume on the crew card)</div>}
              </>
            ) : (
              <div className="kv"><span>{b.scope} (USD)</span><b>${b.usdUsed.toFixed(2)} · <span style={{ color: 'var(--ok)' }}>platform-managed</span></b></div>
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

      {/* Live log — collapsible & scroll-isolated so the churn stays out of your way. */}
      <section className="card span2">
        <h3 className="collapse" onClick={() => setFeedOpen((o) => !o)}>
          <span className="chev">{feedOpen ? '▾' : '▸'}</span> Live governance decisions
          <span className="src">live · PDP · {decisions.length} recent</span>
        </h3>
        {feedOpen && (
          <div className="feed scrolly">
            {decisions.map((d, i) => {
              const ov = resolved[d.id];
              const verdict = ov ?? d.verdict;
              return (
                <div className={`dec ${verdict}${i === 0 && !ov ? ' fresh' : ''}`} key={d.id}>
                  <span className="verdict">{verdict.toUpperCase()}</span>
                  <div className="what">
                    <b>{nameFor(theme, d.actor)}</b> · {d.tool} {d.target ?? ''}
                    <div className="reason">{ov ? (ov === 'allow' ? '✓ approved by operator' : '✗ denied by operator') : d.reason}</div>
                  </div>
                  <span className="t">{d.ts}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {monitor && (
        <section className="card span2">
          <h3>Security monitor — {nameFor(theme, 'hank')} <span className="src">live · read-only sweep</span></h3>
          <div className="stat">
            <div className="s"><div className="n ok">{monitor.counters.boundaryEscapes}</div><div className="l">Boundary esc.</div></div>
            <div className="s"><div className="n ok">{monitor.counters.hashMismatches}</div><div className="l">Hash mism.</div></div>
            <div className="s"><div className="n warn">{monitor.counters.denials}</div><div className="l">Denials</div></div>
            <div className="s"><div className="n">{monitor.counters.casualties}</div><div className="l">Casualties</div></div>
          </div>
          <div className={`ribbon ${monitor.reconciled ? 'ok' : 'bad'}`}>
            {monitor.reconciled ? '✓ Watcher reconciled against deterministic counters.' : '⚠ Anomalies detected (boundary / hash / budget / orphan) - investigate.'} Last sweep {monitor.lastSweepTs}.
          </div>
        </section>
      )}

      {/* Crew detail drawer — boundary, allowlist, recent posture, governed actions. */}
      {selected && drawerCrew && (
        <>
          <div className="drawer-scrim" onClick={() => setSelected(null)} />
          <aside className="drawer" role="dialog" aria-label="Crew detail">
            <div className="drawer-head">
              <div className="avatar lg"><CrewAvatar id={drawerCrew.id} /></div>
              <div style={{ flex: 1 }}>
                <div className="nm">{nameFor(theme, drawerCrew.id)}</div>
                <div className="role">{detail?.role ?? drawerCrew.role}{detail?.domain ? ` · ${detail.domain}` : ''}</div>
                <div className="st">
                  <span className={`tag ${statusOf(drawerCrew)}`}><i className="led" /> {statusOf(drawerCrew)}</span>
                  <span className={`risk-${drawerCrew.riskTier}`} title="Authority tier: how much governance scrutiny this crew role gets">clearance: {drawerCrew.riskTier}</span>
                  {drawerCrew.currentTaskId && <span className="muted">{drawerCrew.currentTaskId}</span>}
                </div>
              </div>
              <button className="x" onClick={() => setSelected(null)} aria-label="Close">✕</button>
            </div>

            {!detail ? <div className="empty">Loading governed posture…</div> : (
              <div className="drawer-body">
                <div className="dsec">
                  <h4>Allowed capabilities <span className="src">deny-by-default otherwise</span></h4>
                  {detail.allowedTools.length === 0 ? <div className="empty">None — cannot invoke tools directly.</div> : (
                    <div className="chips">{detail.allowedTools.map((t) => <span className="chip" key={t}>{t}</span>)}</div>
                  )}
                </div>
                <div className="dsec">
                  <h4>Boundary</h4>
                  <div className="kv"><span>Visibility</span><b className="mono">{detail.boundary.visibility.join(', ') || '—'}</b></div>
                  <div className="kv"><span>Write</span><b className="mono">{detail.boundary.write.join(', ') || 'none (read-only)'}</b></div>
                </div>
                {detail.notes && detail.notes.length > 0 && (
                  <div className="dsec">
                    <h4>Governance notes</h4>
                    <ul className="notes">{detail.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </div>
                )}
                <div className="dsec">
                  <h4>Recent decisions</h4>
                  {(() => {
                    const mine = decisions.filter((d) => d.actor === drawerCrew.id).slice(0, 6);
                    return mine.length === 0 ? <div className="empty">No recent activity in the live window.</div> : (
                      <div className="feed">
                        {mine.map((d) => {
                          const verdict = resolved[d.id] ?? d.verdict;
                          return (
                            <div className={`dec ${verdict}`} key={d.id}>
                              <span className="verdict">{verdict.toUpperCase()}</span>
                              <div className="what">{d.tool} {d.target ?? ''}<div className="reason">{d.reason}</div></div>
                              <span className="t">{d.ts}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
                {statusOf(drawerCrew) === 'paused' && (
                  <button className="act resume wide" onClick={() => { void resume(drawerCrew.id); }}>Resume agent</button>
                )}
              </div>
            )}
          </aside>
        </>
      )}
    </main>
  );
}
