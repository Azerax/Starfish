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

  async function load() {
    const ps = await bridge.getProviders();
    const a = await bridge.getActiveProvider();
    setProviders(ps); setActiveId(a.id); setSel(a.id);
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
        </div>
        <div className="wfoot">
          <button className="btn" onClick={onBack}>Back to Bridge</button>
          <button className="btn primary" onClick={apply}>Save</button>
        </div>
      </div>
    </div>
  );
}
