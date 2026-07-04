import type { ThemePanelProps } from './types';
const fg = { high: '#b42318', medium: '#b54708', low: '#067647' } as Record<string, string>;
const bg = { high: '#fef3f2', medium: '#fffaeb', low: '#ecfdf3' } as Record<string, string>;
export function CalmPanel({ items, monitor, onResolve }: ThemePanelProps) {
  return (
    <div style={{ fontFamily: 'ui-sans-serif,system-ui,sans-serif', color: '#101828' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>Needs your go / no-go</span>
        <span style={{ fontSize: 13, color: '#667085' }}>{items.length} pending</span>
      </div>
      {items.length === 0 ? <p style={{ color: '#98a2b3', fontSize: 14 }}>Nothing awaiting you.</p> : items.map((p) => (
        <div key={p.id} style={{ border: '1px solid #eaecf0', borderRadius: 12, padding: '14px 16px', marginBottom: 12, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>{p.actor}</b>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: '#667085' }}>{p.tool}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 999, background: bg[p.riskTier ?? 'low'] ?? '#f2f4f7', color: fg[p.riskTier ?? 'low'] ?? '#475467' }}>{p.riskTier ?? 'low'}</span>
          </div>
          {p.target && <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, marginBottom: 4 }}>{p.target}</div>}
          {p.reason && <div style={{ fontSize: 13, color: '#667085', marginBottom: 12 }}>{p.reason}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onResolve(p.id, 'approve')} style={{ border: '1px solid #067647', color: '#067647', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Approve</button>
            <button onClick={() => onResolve(p.id, 'deny')} style={{ border: '1px solid #d92d20', color: '#d92d20', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Deny</button>
          </div>
        </div>
      ))}
      {monitor && <div style={{ fontSize: 12, color: '#667085', marginTop: 8 }}>{monitor.safeMode ? 'SAFE MODE · ' : ''}denials {monitor.counters.denials}</div>}
    </div>
  );
}
