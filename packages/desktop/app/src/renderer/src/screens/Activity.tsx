import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { DecisionLogEntry } from '../bridge/types';
import { useTheme } from '../theme/ThemeProvider';
import { displayName } from '../theme/themes';

// Activity — the full live governance-decision stream, on its OWN screen. It was moved off the Bridge so
// the Bridge stays within one viewport (Starfish rule: no critical info below the fold on the dashboard);
// the Bridge shows only a live count that links here.
export function Activity() {
  const bridge = getBridge();
  const { theme } = useTheme();
  const [decisions, setDecisions] = useState<DecisionLogEntry[]>([]);

  useEffect(() => {
    const load = () => void bridge.getDecisions(80).then(setDecisions).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [bridge]);

  const denials = decisions.filter((d) => d.verdict === 'deny').length;
  const asks = decisions.filter((d) => d.verdict === 'ask').length;
  const allows = decisions.filter((d) => d.verdict === 'allow').length;

  return (
    <main className="bridge">
      <div className="secondary" style={{ marginTop: 0, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="s"><div className="n">{allows}</div><div className="l">Allowed</div></div>
        <div className="s"><div className="n warn">{asks}</div><div className="l">Asks</div></div>
        <div className="s"><div className="n" style={{ color: 'var(--deny)' }}>{denials}</div><div className="l">Denied</div></div>
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <h3>Live governance decisions <span className="src">PDP · newest first · {decisions.length} recent</span></h3>
        {decisions.length === 0 ? <div className="empty">No decisions yet.</div> : (
          <div className="feed">
            {decisions.map((d) => (
              <div className={`dec ${d.verdict}`} key={d.id}>
                <span className="verdict">{d.verdict.toUpperCase()}</span>
                <div className="what"><b>{displayName(theme, d.actor)}</b> · {d.tool} {d.target ?? ''}
                  <div className="reason">{d.reason}</div></div>
                <span className="t">{d.descriptor ? `${d.descriptor} · ` : ''}{d.ts}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
