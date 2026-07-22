import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { ActionResult, DecisionLogEntry } from '../bridge/types';

// HOME — the calm landing surface. One input, one verb. Governance is present but quiet: a small
// "Protected & recording" status, not a cockpit. This is the anti-dashboard — OpenClaw ease-of-use,
// governed. It sits on the proven dispatch seam (requestAction -> Task -> AgentLoop -> real artifact;
// see dispatch-e2e.conformance). The Bridge cockpit stays one click deeper for when you want the detail.

const CALM = {
  ink: '#1d1f20', ink2: '#2b2b2d', line: '#e2e2e4', line2: '#ededee',
  paper: '#f7f7f8', card: '#ffffff', slate: '#5980a6, ', slateSolid: '#5980a6',
  muted: '#8a8d90', faint: '#a9acae',
};

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

// Turn a governed decision into a plain past-tense line — "Drafted the Q3 summary", not "ingress:fs.write".
function humanize(d: DecisionLogEntry): string {
  const t = (d.tool || '').toLowerCase();
  const name = d.target ? d.target.split(/[\\/]/).pop() : undefined;
  if (t.includes('fs.write') || t.includes('write')) return name ? `Wrote ${name}` : 'Wrote a file';
  if (t.includes('fs.read') || t.includes('read')) return name ? `Read ${name}` : 'Read a file';
  if (t.includes('fs.list') || t.includes('list')) return 'Listed a directory';
  if (t.includes('git')) return 'Committed changes';
  if (t.includes('run_tests') || t.includes('test')) return 'Ran the tests';
  if (t.includes('net')) return 'Fetched from the network';
  if (t.includes('shell')) return 'Ran a command';
  return d.reason ? d.reason.slice(0, 60) : d.tool || 'Did some work';
}

export function Home({ go }: { go: (v: 'bridge' | 'activity' | 'comm') => void }) {
  const bridge = getBridge();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ActionResult | null>(null);
  const [recent, setRecent] = useState<DecisionLogEntry[]>([]);
  const [awaiting, setAwaiting] = useState<DecisionLogEntry[]>([]);

  async function start() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setLast(null);
    try {
      const r = await bridge.requestAction({ actor: 'operator', intent: { kind: 'mission', text: t } });
      setLast(r); setText('');
    } catch (e) {
      setLast({ decision: { allow: false, reason: 'could not start: ' + ((e as Error).message || String(e)) }, applied: false });
    } finally { setBusy(false); void refresh(); }
  }

  async function refresh() {
    try {
      const ds = await bridge.getDecisions(12);
      setRecent(ds.filter((d) => d.verdict === 'allow').slice(0, 6));
      setAwaiting(ds.filter((d) => d.verdict === 'ask' && !String(d.tool || '').startsWith('capability')));
    } catch { /* pre-boot / transient */ }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, busy ? 1500 : 6000);
    return () => clearInterval(id);
  }, [busy]);   // eslint-disable-line react-hooks/exhaustive-deps

  const S = {
    wrap: { maxWidth: 620, margin: '0 auto', padding: '0 28px', color: CALM.ink } as const,
    topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0 22px', borderBottom: `1px solid ${CALM.line2}` } as const,
    brand: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 500 } as const,
    dot: { width: 9, height: 9, borderRadius: '50%', background: CALM.slateSolid, display: 'inline-block' } as const,
    status: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: CALM.muted } as const,
    h1: { fontSize: 30, fontWeight: 600, letterSpacing: '-0.01em', margin: '38px 0 6px' } as const,
    sub: { fontSize: 16, color: CALM.muted, margin: '0 0 22px' } as const,
    row: { display: 'flex', gap: 10 } as const,
    input: { flex: 1, height: 48, border: `1px solid ${CALM.line}`, borderRadius: 8, padding: '0 15px', fontSize: 15, color: CALM.ink, background: CALM.card, outline: 'none' } as const,
    start: { height: 48, padding: '0 22px', border: 'none', borderRadius: 8, background: CALM.slateSolid, color: '#fff', fontSize: 15, fontWeight: 500, cursor: busy || !text.trim() ? 'default' : 'pointer', opacity: busy || !text.trim() ? 0.55 : 1 } as const,
    kicker: { fontSize: 12, letterSpacing: '0.09em', color: CALM.faint, textTransform: 'uppercase' as const, margin: '34px 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    card: { border: `1px solid ${CALM.line}`, borderRadius: 10, padding: '18px 18px', display: 'flex', gap: 15, alignItems: 'center' } as const,
    check: { width: 40, height: 40, borderRadius: 8, border: `1px solid ${CALM.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CALM.muted, fontSize: 18 } as const,
    rowTitle: { fontSize: 15, fontWeight: 500, margin: 0 } as const,
    rowSub: { fontSize: 14, color: CALM.muted, margin: '2px 0 0' } as const,
    actItem: { display: 'flex', gap: 16, padding: '13px 0', borderBottom: `1px solid ${CALM.line2}`, alignItems: 'baseline' } as const,
    actTime: { fontSize: 13, color: CALM.faint, minWidth: 44, fontVariantNumeric: 'tabular-nums' } as const,
    actText: { fontSize: 15, color: CALM.ink2 } as const,
    seeAll: { fontSize: 13, color: CALM.slateSolid, cursor: 'pointer', textTransform: 'none' as const, letterSpacing: 0, textDecoration: 'underline', textUnderlineOffset: 2 },
    link: { color: CALM.slateSolid, cursor: 'pointer' } as const,
  };

  const running = busy || awaiting.length > 0;

  return (
    <div style={{ background: CALM.paper, minHeight: '100vh', paddingBottom: 40 }}>
      <div style={S.wrap}>
        <div style={S.topbar}>
          <span style={S.brand}><span style={S.dot} /> Starfish</span>
          <span style={S.status} title="Every action is governed and written to the audit log">
            <span aria-hidden>🔒</span> Protected &amp; recording
          </span>
        </div>

        <h1 style={S.h1}>{greeting()}</h1>
        <p style={S.sub}>Tell me what you&rsquo;d like done.</p>

        <div style={S.row}>
          <input
            style={S.input}
            value={text}
            placeholder="Draft the Q3 summary and send it to the team"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void start(); }}
            disabled={busy}
          />
          <button style={S.start} onClick={() => void start()} disabled={busy || !text.trim()}>
            {busy ? 'Starting…' : 'Start'}
          </button>
        </div>

        {last && !last.decision.allow && (
          <p style={{ fontSize: 14, color: last.decision.ask ? '#8a6d3b' : '#a3402d', margin: '12px 2px 0' }}>
            {last.decision.ask ? 'Awaiting your approval — ' : ''}{last.decision.reason}
          </p>
        )}

        <div style={S.kicker}><span>Right now</span></div>
        <div style={S.card}>
          <div style={S.check} aria-hidden>{running ? '•' : '✓'}</div>
          <div>
            <p style={S.rowTitle}>{running ? 'Working on it' : 'Ready when you are'}</p>
            <p style={S.rowSub}>
              {awaiting.length > 0
                ? `${awaiting.length} action${awaiting.length > 1 ? 's' : ''} awaiting your go-ahead — `
                : busy ? 'A governed run is in progress' : 'Nothing running right now'}
              {awaiting.length > 0 && <span style={S.link} onClick={() => go('comm')}>review</span>}
            </p>
          </div>
        </div>

        <div style={S.kicker}><span>Recent activity</span><span style={S.seeAll} onClick={() => go('activity')}>See all</span></div>
        {recent.length === 0 ? (
          <p style={{ fontSize: 14, color: CALM.faint, padding: '8px 0' }}>Nothing yet — your first governed run will show up here.</p>
        ) : (
          <div>
            {recent.map((d) => (
              <div key={d.id} style={S.actItem}>
                <span style={S.actTime}>{(d.ts || '').slice(0, 5)}</span>
                <span style={S.actText}>{humanize(d)}</span>
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 12.5, color: CALM.faint, marginTop: 30 }}>
          <span style={S.link} onClick={() => go('bridge')}>Open the full cockpit →</span>
        </p>
      </div>
    </div>
  );
}
