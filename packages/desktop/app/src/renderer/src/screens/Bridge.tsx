import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { CrewMemberView, DecisionLogEntry, BudgetView, MonitorView } from '../bridge/types';
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

  useEffect(() => {
    const load = () => {
      void bridge.getCrew().then(setCrew);
      void bridge.getDecisions(8).then(setDecisions);
      void bridge.getBudgets().then(setBudgets);
      void bridge.getMonitor().then(setMonitor);
    };
    load();
    const t = setInterval(load, 2500);          // live refresh
    return () => clearInterval(t);
  }, [bridge]);

  return (
    <main className="grid">
      <section className="card span2">
        <h3>Crew <span className="src">← ServiceRegistry</span></h3>
        <div className="crew">
          {crew.map((c) => (
            <div className="c" key={c.id}>
              <div className="avatar"><CrewAvatar id={c.id} /></div>
              <div>
                <div className="nm">{nameFor(theme, c.id)}</div>
                <div className="role">{c.role}</div>
                <div className="st">
                  <span className={`tag ${c.status}`}><i className="led" /> {c.status}</span>
                  {c.currentTaskId && <span className="muted">{c.currentTaskId}</span>}
                  <span className={`risk-${c.riskTier}`}>risk: {c.riskTier}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Live governance decisions <span className="src">← PDP</span></h3>
        <div className="feed">
          {decisions.map((d, i) => (
            <div className={`dec ${d.verdict}${i === 0 ? ' fresh' : ''}`} key={d.id}>
              <span className="verdict">{d.verdict.toUpperCase()}</span>
              <div className="what"><b>{nameFor(theme, d.actor)}</b> · {d.tool} {d.target ?? ''}<div className="reason">{d.reason}</div></div>
              <span className="t">{d.ts}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Token Governor <span className="src">← TokenGovernor</span></h3>
        {budgets.map((b) => (
          <div key={b.scope} className="budget">
            <div className="kv"><span>{b.scope} (USD)</span><b>${b.usdUsed.toFixed(2)} / ${b.usdLimit.toFixed(2)}</b></div>
            <div className="meter"><i style={{ width: `${Math.min(100, (b.usdUsed / b.usdLimit) * 100)}%`, background: b.status === 'hard' ? 'var(--deny)' : 'linear-gradient(90deg,var(--ok),var(--warn))' }} /></div>
            {b.status === 'hard' && <div className="warn">hard cap — paused (resume requires human)</div>}
          </div>
        ))}
      </section>

      {monitor && (
        <section className="card span2">
          <h3>Security monitor — Hank <span className="src">← SecurityMonitor.sweep()</span></h3>
          <div className="stat">
            <div className="s"><div className="n ok">{monitor.counters.boundaryEscapes}</div><div className="l">Boundary esc.</div></div>
            <div className="s"><div className="n ok">{monitor.counters.hashMismatches}</div><div className="l">Hash mism.</div></div>
            <div className="s"><div className="n warn">{monitor.counters.denials}</div><div className="l">Denials</div></div>
            <div className="s"><div className="n">{monitor.counters.casualties}</div><div className="l">Casualties</div></div>
          </div>
          <div className={`ribbon ${monitor.reconciled ? 'ok' : 'bad'}`}>
            {monitor.reconciled ? '✓ Watcher reconciled against deterministic counters.' : '⚠ Watcher discrepancy — investigate.'} Last sweep {monitor.lastSweepTs}.
          </div>
        </section>
      )}
    </main>
  );
}
