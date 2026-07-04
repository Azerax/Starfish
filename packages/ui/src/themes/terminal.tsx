import type { ThemePanelProps } from './types';
const tag = (r?: string): string => (r === 'high' ? '#f07171' : r === 'medium' ? '#e0af68' : '#7fd0a6');
export function TerminalPanel({ items, monitor, onResolve }: ThemePanelProps) {
  return (
    <div style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', background: '#0c0c0c', color: '#d4d4d4', borderRadius: 10, padding: 14, border: '1px solid #2a2a2a', fontSize: 13, lineHeight: 1.6 }}>
      <div style={{ color: '#7fd0a6', marginBottom: 10 }}>starfish@governed ~ % pending --sort risk  <span style={{ color: '#6a6a6a' }}>({items.length})</span></div>
      {items.length === 0 ? <div style={{ color: '#6a6a6a' }}>nothing awaiting you.</div> : items.map((p) => (
        <div key={p.id} style={{ marginBottom: 8 }}>
          <div>
            <span style={{ color: tag(p.riskTier) }}>[{(p.riskTier ?? 'low').toUpperCase()}]</span>{' '}
            <span style={{ color: '#9cdcfe' }}>{p.actor}</span> <span style={{ color: '#d4d4d4' }}>{p.tool}</span>
            {p.target ? <span style={{ color: '#c8c8c8' }}> -&gt; {p.target}</span> : null}
          </div>
          {p.reason && <div style={{ color: '#8a8a8a' }}>  # {p.reason}</div>}
          <div style={{ marginTop: 2 }}>
            <button onClick={() => onResolve(p.id, 'approve')} style={{ background: 'transparent', color: '#7fd0a6', border: '1px solid #2c5c43', borderRadius: 4, padding: '2px 8px', fontFamily: 'inherit', cursor: 'pointer', marginRight: 6 }}>[a]pprove</button>
            <button onClick={() => onResolve(p.id, 'deny')} style={{ background: 'transparent', color: '#f07171', border: '1px solid #5a2a2a', borderRadius: 4, padding: '2px 8px', fontFamily: 'inherit', cursor: 'pointer' }}>[d]eny</button>
          </div>
        </div>
      ))}
      <div style={{ color: '#6a6a6a', marginTop: 8 }}>{monitor && monitor.safeMode ? 'safe-mode ' : ''}denials={monitor ? monitor.counters.denials : 0} chain=ok</div>
    </div>
  );
}
