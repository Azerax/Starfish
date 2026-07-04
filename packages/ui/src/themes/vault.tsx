import type { ThemePanelProps } from './types';
export function VaultPanel({ items, monitor, onResolve }: ThemePanelProps) {
  return (
    <div style={{ fontFamily: 'ui-sans-serif,system-ui,sans-serif', background: '#17140e', color: '#efe7d6', borderRadius: 12, padding: 16, border: '1px solid #3a3222' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>Vault · dual control</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#c9a86a' }}>{items.length} awaiting key 2</span>
      </div>
      {items.length === 0 ? <p style={{ color: '#8a7f68', fontSize: 14 }}>Vault sealed. Nothing awaiting you.</p> : items.map((p) => (
        <div key={p.id} style={{ border: '1px solid #3a3222', borderRadius: 10, padding: 12, marginBottom: 10, background: '#1e1a12' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13 }}>{p.tool}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#e0b45f' }}>{p.riskTier ?? 'low'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#7fd0a6', border: '1px solid #2c5c43', borderRadius: 8, padding: '3px 8px' }}>key 1 · {p.actor} turned</span>
            <span style={{ fontSize: 12, color: '#8a7f68', border: '1px dashed #5a4f38', borderRadius: 8, padding: '3px 8px' }}>key 2 · you</span>
          </div>
          {p.target && <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: '#c9beA6', marginBottom: 10 }}>{p.target}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onResolve(p.id, 'approve')} style={{ background: '#c9a24a', color: '#17140e', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 500, cursor: 'pointer' }}>Turn key 2 · approve</button>
            <button onClick={() => onResolve(p.id, 'deny')} style={{ background: 'transparent', color: '#e0a0a0', border: '1px solid #6b3a3a', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Refuse</button>
          </div>
        </div>
      ))}
      <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: '#8a7f68', marginTop: 10, borderTop: '1px solid #3a3222', paddingTop: 8 }}>ledger · {monitor ? 'denials ' + monitor.counters.denials : 'chained'} · proposer != approver</div>
    </div>
  );
}
