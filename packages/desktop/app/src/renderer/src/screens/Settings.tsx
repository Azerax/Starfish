import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { ProviderView } from '../bridge/types';

export function Settings({ onBack }: { onBack: () => void }) {
  const bridge = getBridge();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [activeId, setActiveId] = useState('anthropic');
  const [sel, setSel] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [costMode, setCostMode] = useState<'platform' | 'starfish'>('platform');
  const [budgetUsd, setBudgetUsd] = useState('');

  async function load() {
    const ps = await bridge.getProviders();
    const a = await bridge.getActiveProvider();
    setProviders(ps); setActiveId(a.id); setSel(a.id);
    const c = await bridge.getCost();
    setCostMode(c.mode); setBudgetUsd(c.budgetUsd ? String(c.budgetUsd) : '');
  }
  useEffect(() => { void load(); }, []);

  const cur = providers.find((p) => p.id === sel);

  async function apply() {
    await bridge.setActiveProvider(sel, cur?.model);
    let note = `Active provider set to ${cur?.name ?? sel}.`;
    if (apiKey.trim()) {
      const r = await bridge.setProviderKey(sel, apiKey.trim());
      note += ` Key sealed via ${r.stored === 'keychain' ? 'OS keychain' : 'local fallback (dev)'}.`;
      setApiKey('');
    }
    await bridge.setCost(costMode, costMode === 'starfish' ? (Number(budgetUsd) || 0) : 0);
    note += costMode === 'platform' ? ' Cost: platform-managed (your provider console cap is the ceiling).' : ` Cost: Starfish cap $${Number(budgetUsd) || 0}.`;
    setMsg(note);
    await load();
  }

  return (
    <div className="wizwrap">
      <div className="wiz">
        <div className="head">
          <div className="ti">Settings<small>Provider &amp; model</small></div>
          <span className="govpill">● GOVERNED · key in OS keychain</span>
        </div>
        <div className="wbody">
          <div className="pane">
            <h2>Model provider</h2>
            <p className="wsub">Starfish is model-agnostic. The active provider runs the work; governance (PDP, vetting, boundary, audit) is unaffected by which model you pick. API keys are stored by the host in the OS keychain and never returned to the UI.</p>
            <div className="field"><label className="lbl">Provider</label>
              <div className="themes">
                {providers.map((p) => (
                  <div key={p.id} className={`themecard${p.id === sel ? ' sel' : ''}`} onClick={() => setSel(p.id)}>
                    <div className="nm">{p.name}{p.id === activeId ? ' · active' : ''}</div>
                    <div className="meta">{p.model}{p.dataEgress ? ' · ⚠ third-party egress' : ''} · {p.hasKey ? 'key set ✓' : (p.requiresKey ? 'no key' : 'no key needed')}</div>
                  </div>
                ))}
              </div>
            </div>
            {cur?.requiresKey && (
              <div className="field"><label className="lbl">API key{cur.hasKey ? ' (replace stored key)' : ''}</label>
                <input type="password" autoComplete="off" placeholder={cur.hasKey ? '•••••••• stored — leave blank to keep' : `Paste your ${cur.name} key`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
            )}
            {cur?.dataEgress && <div className="wnote" style={{ borderColor: 'var(--deny)' }}>⚠ <b>Data-egress:</b> a hosted router forwards prompts/context to a third party.</div>}
            {msg && <div className="whint">{msg}</div>}
          </div>
          <div className="pane">
            <h2>Cost control</h2>
            <p className="wsub">Starfish never raises your provider's own spend limit. Choose who enforces cost: your API platform (recommended - set a hard cap in the provider console) or an additional Starfish budget that pauses the worker locally.</p>
            <div className="themes">
              <div className={`themecard${costMode === 'platform' ? ' sel' : ''}`} onClick={() => setCostMode('platform')}>
                <div className="nm">Platform-managed{costMode === 'platform' ? ' · active' : ''}</div>
                <div className="meta">Your provider console cap is the ceiling. Starfish sets no local budget.</div>
              </div>
              <div className={`themecard${costMode === 'starfish' ? ' sel' : ''}`} onClick={() => setCostMode('starfish')}>
                <div className="nm">Starfish budget cap{costMode === 'starfish' ? ' · active' : ''}</div>
                <div className="meta">A local USD hard limit; the worker pauses when reached.</div>
              </div>
            </div>
            {costMode === 'starfish' && (
              <div className="field"><label className="lbl">Hard cap (USD)</label>
                <input type="number" min="0" step="1" placeholder="e.g. 10" value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <div className="wfoot">
          <button className="btn" onClick={onBack}>Back to Bridge</button>
          <button className="btn primary" onClick={apply}>Save</button>
        </div>
      </div>
    </div>
  );
}
