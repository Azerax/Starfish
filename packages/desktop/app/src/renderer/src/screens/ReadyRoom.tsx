import type { ReadinessBlocker } from '../bridge/types';

// My Ready Room — the operator's checklist of "total stop" issues that block real work. Items here
// pulse the Ready Room nav red and raise a forced (dismissible) popup until resolved.
export function ReadyRoom({ blockers, onBack, go }: { blockers: ReadinessBlocker[]; onBack: () => void; go: (v: string) => void }) {
  return (
    <div className="wizwrap"><div className="wiz">
      <div className="head">
        <div className="ti">My Ready Room<small>Issues that block your work</small></div>
        <span className="govpill">{blockers.length === 0 ? '● all clear' : `● ${blockers.length} to resolve`}</span>
      </div>
      <div className="wbody">
        {blockers.length === 0 ? (
          <div className="pane"><h2>All clear</h2><p className="wsub">Nothing is blocking you. Orders will dispatch normally.</p></div>
        ) : blockers.map((b) => (
          <div key={b.id} className={`readyitem ${b.severity}`}>
            <div className="ri-main">
              <div className="ri-title">{b.severity === 'stop' ? '⛔' : '⚠'} {b.title}</div>
              <div className="ri-detail">{b.detail}</div>
            </div>
            {b.action && <button className="btn primary" onClick={() => go(b.action!.view)}>{b.action.label}</button>}
          </div>
        ))}
      </div>
      <div className="wfoot"><button className="btn" onClick={onBack}>Back to Bridge</button></div>
    </div></div>
  );
}
