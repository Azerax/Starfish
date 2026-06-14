import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { DefaultSkillView } from '../bridge/types';
import { useTheme } from '../theme/ThemeProvider';
import { FleetBadge } from '../theme/icons';

const LABELS = ['Welcome', 'Operator & theme', 'Governed intake', 'Ready'];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const bridge = getBridge();
  const { theme, themes, setThemeId } = useTheme();
  const [step, setStep] = useState(0);
  const [operator, setOperator] = useState('Grand Admiral Scotticus');
  const [skills, setSkills] = useState<DefaultSkillView[]>([]);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ registered: string[]; quarantined: string[]; approved: string[] } | null>(null);

  useEffect(() => { void bridge.getDefaultSkills().then((s) => {
    setSkills(s);
    const c: Record<string, boolean> = {};
    for (const sk of s) if (sk.expectedRisk === 'low') c[sk.id] = true;   // Low auto-enables
    setConsent(c);
  }); }, [bridge]);

  const enabledCount = Object.values(consent).filter(Boolean).length;

  async function finish() {
    const enabledIds = Object.entries(consent).filter(([, v]) => v).map(([k]) => k);
    const r = await bridge.completeOnboarding({ operator, theme: theme.id, enabledIds });
    setResult({ registered: r.registered, quarantined: r.quarantined, approved: r.approved });
    setStep(3);
  }

  function next() {
    if (step === 2) { void finish(); return; }
    if (step === 3) { onDone(); return; }
    setStep((s) => Math.min(3, s + 1));
  }

  return (
    <div className="wizwrap">
      <div className="wiz">
        <div className="head">
          <span className="badge-slot"><FleetBadge size={28} /></span>
          <div className="ti">Project Starfish<small>First-run setup</small></div>
          <span className="govpill">● GOVERNED · fail-closed</span>
        </div>
        <div className="steps">{[0, 1, 2, 3].map((i) => <div key={i} className={`d${i <= step ? ' on' : ''}`} />)}</div>
        <div className="steplabel">Step {step + 1} of 4 · {LABELS[step]}</div>

        <div className="wbody">
          {step === 0 && (
            <div className="pane">
              <h2>Report for duty</h2>
              <p className="wsub">Project Starfish is a <b>governance-first</b> AI ecosystem. Before any agent can act, governance loads and defaults to <b>deny</b>. You — the operator — are the final authority. This setup makes you the approver and brings the default skills under governance.</p>
              <div className="wnote">Nothing executes during setup. Governance is already up (fail-closed); you're taking command.</div>
            </div>
          )}
          {step === 1 && (
            <div className="pane">
              <h2>Who's in command?</h2>
              <p className="wsub">Your name is stamped on every approval. By <b>proposer ≠ approver</b>, agents can never self-authorize.</p>
              <div className="field"><label className="lbl">Operator name</label>
                <input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} /></div>
              <div className="field"><label className="lbl">Theme</label>
                <div className="themes">
                  {themes.map((t) => (
                    <div key={t.id} className={`themecard${t.id === theme.id ? ' sel' : ''}`} onClick={() => setThemeId(t.id)}>
                      <div className="nm">{t.name}</div>
                      <div className="sw">{Object.values(t.palette).slice(0, 4).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="pane">
              <h2>Governed intake</h2>
              <p className="wsub">Toby vets the default catalog (from <b>anthropics/skills</b>). <b>Low auto-enables; Medium+ is quarantined until you consent.</b> The only door into the registry.</p>
              {skills.map((s) => {
                const auto = s.expectedRisk === 'low';
                const on = consent[s.id] ?? false;
                return (
                  <div className="caprow" key={s.id}>
                    <div><div className="nm">{s.id}</div><div className="meta">{s.plugin} · {s.summary}</div></div>
                    <span className={`risk ${s.expectedRisk}`}>{s.expectedRisk}</span>
                    <div className="disp">{auto ? <span className="auto">auto-enabled ✓</span> : (
                      <span className="consent">
                        <button className={`mini${on ? ' on' : ''}`} onClick={() => setConsent((c) => ({ ...c, [s.id]: true }))}>Enable</button>
                        <button className={`mini${!on ? ' off' : ''}`} onClick={() => setConsent((c) => ({ ...c, [s.id]: false }))}>Quarantine</button>
                      </span>)}</div>
                  </div>
                );
              })}
              <div className="whint">{enabledCount} enabled · {skills.length - enabledCount} held — change anytime on the Transporter screen.</div>
            </div>
          )}
          {step === 3 && (
            <div className="pane finish">
              <div className="seal">✓</div>
              <h2>You have the conn</h2>
              <div className="summary">
                Operator: <b>{operator}</b><br />
                Theme: <b>{theme.name}</b><br />
                Registry: <b>{result ? result.registered.length + result.approved.length : enabledCount} enabled</b>, <b>{result ? result.quarantined.length : 0} quarantined</b><br />
                Governance: <b style={{ color: 'var(--ok)' }}>active · fail-closed ✓</b>
              </div>
            </div>
          )}
        </div>

        <div className="wfoot">
          <button className="btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
          <button className="btn primary" onClick={next}>{step === 0 ? 'Begin' : step === 2 ? 'Confirm & govern' : step === 3 ? 'Enter the Bridge' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
