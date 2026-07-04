import type { ThemePanelProps } from './types';
export function RadarPanel({ items, monitor, onResolve }: ThemePanelProps) {
  return (
    <div style={{ fontFamily: 'ui-sans-serif,system-ui,sans-serif', background: '#07130d', color: '#cdeadd', borderRadius: 12, padding: 16, border: '1px solid #164a36' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="none" stroke="#1c5c43" /><circle cx="11" cy="11" r="5" fill="none" stroke="#164a36" /><path d="M11 11 L11 1 A10 10 0 0 1 20 7 Z" fill="#2fae7d" opacity="0.25" /><circle cx="11" cy="11" r="1.5" fill="#3fe0a0" /></svg>
        <span style={{ fontSize: 16, fontWeight: 500 }}>Approach control</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#5cbf9c' }}>{items.length} requesting clearance</span>
      </div>
      {items.length === 0 ? <p style={{ color: '#4f8a72', fontSize: 14 }}>Pattern clear. No clearance requests.</p> : items.map((p) => (
        <div key={p.id} style={{ border: '1px solid #164a36', borderRadius: 10, padding: 12, marginBottom: 10, background: '#0b1f16' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: p.riskTier === 'high' ? '#f0997b' : '#3fe0a0' }} />
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13 }}>{p.actor}</span>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: '#5cbf9c' }}>{p.tool}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#a7d8c4' }}>{p.riskTier ?? 'low'}</span>
          </div>
          {p.target && <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: '#9ccbb8', marginBottom: 10 }}>{p.target}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onResolve(p.id, 'approve')} style={{ background: '#1d9e75', color: '#04140d', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 500, cursor: 'pointer' }}>Cleared</button>
            <button onClick={() => onResolve(p.id, 'deny')} style={{ background: 'transparent', color: '#f0b4a0', border: '1px solid #6b3a2a', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Go around</button>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#4f8a72', marginTop: 10 }}>{monitor && monitor.safeMode ? 'GROUND STOP · ' : ''}separations nominal · denials {monitor ? monitor.counters.denials : 0}</div>
    </div>
  );
}
