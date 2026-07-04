import type { ThemePanelProps } from './types';
import { anomalies } from './types';
export function CommandPanel({ items, monitor, onResolve }: ThemePanelProps) {
  const metric = (label: string, val: string | number, color?: string) => (
    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', flex: 1 }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: color ?? '#0f172a' }}>{val}</div>
    </div>
  );
  return (
    <div style={{ fontFamily: 'ui-sans-serif,system-ui,sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {metric('Pending', items.length, '#b54708')}
        {metric('Denials', monitor ? monitor.counters.denials : 0)}
        {metric('Anomalies', anomalies(monitor), anomalies(monitor) ? '#b42318' : '#067647')}
        {metric('Mode', monitor && monitor.safeMode ? 'SAFE' : 'live', monitor && monitor.safeMode ? '#b42318' : '#067647')}
      </div>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
        <div style={{ fontSize: 13, fontWeight: 500, padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>Decision queue</div>
        {items.length === 0 ? <div style={{ padding: 14, color: '#94a3b8', fontSize: 13 }}>Queue empty.</div> : items.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: p.riskTier === 'high' ? '#d92d20' : p.riskTier === 'medium' ? '#f79009' : '#12b76a' }} />
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{p.tool}</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>{p.actor}</span>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{p.target ?? ''}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={() => onResolve(p.id, 'approve')} style={{ border: '1px solid #067647', color: '#067647', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Approve</button>
              <button onClick={() => onResolve(p.id, 'deny')} style={{ border: '1px solid #d92d20', color: '#d92d20', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Deny</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
