import { useEffect, useState } from 'react';
import { getBridge } from '../bridge/useBridge';
import type { DefaultSkillView, ActionResult } from '../bridge/types';

// PADD — the Skill Library: the registry visualized by category. Only registered skills appear/run;
// invoking one is a deterministic, GOVERNED dispatch (the PDP adjudicates; elevated -> awaiting approval).
export function Padd({ onBack }: { onBack: () => void }) {
  const bridge = getBridge();
  const [skills, setSkills] = useState<DefaultSkillView[]>([]);
  const [result, setResult] = useState<Record<string, ActionResult>>({});

  useEffect(() => { void bridge.getDefaultSkills().then(setSkills); }, []);

  const byCat: Record<string, DefaultSkillView[]> = {};
  for (const s of skills) (byCat[s.category] ||= []).push(s);

  async function run(id: string) {
    const r = await bridge.requestAction({ actor: 'operator', intent: { kind: 'invoke', skill: id } });
    setResult((m) => ({ ...m, [id]: r }));
  }

  return (
    <div className="wizwrap"><div className="wiz">
      <div className="head">
        <div className="ti">PADD<small>Skill Library · registered capabilities</small></div>
        <span className="govpill">● GOVERNED · only registered skills run</span>
      </div>
      <div className="wbody">
        {skills.length === 0 && <p className="wsub">No registered skills yet. Vet a pack on the Transporter screen or with <code>starfish govern</code>.</p>}
        {Object.keys(byCat).sort().map((cat) => (
          <div key={cat} className="pane">
            <h2 style={{ textTransform: 'capitalize', fontSize: 18 }}>{cat}</h2>
            {byCat[cat].map((s) => {
              const r = result[s.id];
              return (
                <div className="caprow" key={s.id}>
                  <div><div className="nm">{s.id}</div><div className="meta">{s.plugin} · {s.summary}</div></div>
                  <span className={`risk ${s.expectedRisk}`}>{s.expectedRisk}</span>
                  <div className="disp">
                    <button className="mini on" onClick={() => run(s.id)}>Run</button>
                    {r && <span style={{ marginLeft: 8 }} className={r.decision.allow ? 'auto' : 'q'}>
                      {r.decision.allow ? 'dispatched ✓' : r.decision.ask ? 'awaiting approval' : 'denied'}
                    </span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="wfoot"><button className="btn" onClick={onBack}>Back to Bridge</button></div>
    </div></div>
  );
}
