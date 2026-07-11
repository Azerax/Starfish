import { useEffect, useRef, useState } from 'react';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import { displayName } from './theme/themes';
import { FleetBadge } from './theme/icons';
import { Bridge } from './screens/Bridge';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { Padd } from './screens/Padd';
import { Comm } from './screens/Comm';
import { ReadyRoom } from './screens/ReadyRoom';
import { getBridge } from './bridge/useBridge';
import type { ReadinessBlocker } from './bridge/types';

type View = 'loading' | 'onboard' | 'bridge' | 'padd' | 'comm' | 'settings' | 'readyroom';

function Clock() {
  const [t, setT] = useState(() => new Date().toTimeString().slice(0, 8));
  useEffect(() => { const id = setInterval(() => setT(new Date().toTimeString().slice(0, 8)), 1000); return () => clearInterval(id); }, []);
  return <span className="pill mono"><span className="dot live" /> {t}</span>;
}

function Header({ go, alerts }: { go: (v: View) => void; alerts: number }) {
  const { theme, themes, setThemeId, mode, toggleMode, canToggle } = useTheme();
  return (
    <header className="topbar">
      <span className="badge-slot"><FleetBadge /></span>
      <div className="brand">Starfish<small>{theme.labels.floor} · governance</small></div>
      <div className="spacer" />
      <Clock />
      <span className="pill"><span className="dot" /> GOVERNED · fail-closed</span>
      <button className={`pill ready${alerts > 0 ? ' pulse' : ''}`} onClick={() => go('readyroom')} title="My Ready Room">🛎 Ready Room{alerts > 0 ? ` · ${alerts}` : ''}</button>
      <button className="pill" onClick={() => go('padd')} title="Skill Library">📟 PADD</button>
      <button className="pill" onClick={() => go('comm')} title="Issue orders">📡 COMM</button>
      <label className="pill">Theme&nbsp;
        <select value={theme.id} onChange={(e) => setThemeId(e.target.value)}>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {canToggle && <button className="pill modetoggle" onClick={toggleMode} title="Toggle light / dark">{mode === 'dark' ? 'Dark' : 'Light'}</button>}
      <button className="pill" onClick={() => go('settings')} title="Provider & model settings">⚙ Settings</button>
    </header>
  );
}

function ReadyModal({ blockers, onResolve, onMinimize, onDismiss }: { blockers: ReadinessBlocker[]; onResolve: (v: string) => void; onMinimize: () => void; onDismiss: () => void }) {
  const stops = blockers.filter((b) => b.severity === 'stop');
  return (
    <div className="modal-overlay">
      <div className="modal-card pulse-border">
        <div className="modal-head">
          <span className="modal-icon">⛔</span>
          <div><div className="modal-title">Action needed to continue</div><div className="modal-sub">{stops.length} issue{stops.length === 1 ? '' : 's'} blocking your work</div></div>
        </div>
        <div className="modal-body">
          {blockers.map((b) => (
            <div key={b.id} className="modal-item">
              <div className="mi-title">{b.title}</div>
              <div className="mi-detail">{b.detail}</div>
              {b.action && <button className="btn primary" onClick={() => onResolve(b.action!.view)}>{b.action.label}</button>}
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onMinimize}>Minimize to Ready Room</button>
          <button className="btn" onClick={onDismiss}>Dismiss for now</button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const [view, setView] = useState<View>('loading');
  const [blockers, setBlockers] = useState<ReadinessBlocker[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const sigRef = useRef('');

  useEffect(() => { getBridge().getOnboarding().then((s) => setView(s.done ? 'bridge' : 'onboard')).catch(() => setView('onboard')); }, []);

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const r = await getBridge().getReadiness();
        if (!live) return;
        const sig = r.blockers.map((b) => b.id).sort().join('|');
        if (sig !== sigRef.current) { sigRef.current = sig; if (r.blockers.length > 0) setDismissed(false); }   // a NEW issue re-raises the popup
        setBlockers(r.blockers);
      } catch { /* ignore transient */ }
    };
    void poll();
    const id = setInterval(poll, 4000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (view === 'loading') return null;
  if (view === 'onboard') return <Onboarding onDone={() => setView('bridge')} />;

  const stops = blockers.filter((b) => b.severity === 'stop');
  const showModal = stops.length > 0 && !dismissed;
  const resolve = (v: string) => { setDismissed(true); setView(v as View); };

  let screen;
  if (view === 'settings') screen = <Settings onBack={() => setView('bridge')} />;
  else if (view === 'padd') screen = <Padd onBack={() => setView('bridge')} />;
  else if (view === 'comm') screen = <Comm onBack={() => setView('bridge')} />;
  else if (view === 'readyroom') screen = <><Header go={setView} alerts={blockers.length} /><ReadyRoom blockers={blockers} onBack={() => setView('bridge')} go={resolve} /></>;
  else screen = <><Header go={setView} alerts={blockers.length} /><Bridge nameFor={displayName} /></>;

  return <>{screen}{showModal && <ReadyModal blockers={blockers} onResolve={resolve} onMinimize={() => { setDismissed(true); setView('readyroom'); }} onDismiss={() => setDismissed(true)} />}</>;
}

// On a governed system, workers must never run as OS admin/root — and Windows hands new accounts admin
// by default. If elevated, warn loudly with a flashing red banner on every screen.
function AdminBanner() {
  const [priv, setPriv] = useState<{ elevated: boolean; user?: string } | null>(null);
  useEffect(() => { void getBridge().getPrivilege?.().then(setPriv).catch(() => {}); }, []);
  if (!priv?.elevated) return null;
  return (
    <div className="admin-banner" role="alert">
      <span className="ab-dot" />
      <span><b>Running as administrator{priv.user ? ` (${priv.user})` : ''}.</b> Governed agents must never run with admin rights — Windows grants this by default. Close Starfish and relaunch as a standard user.</span>
    </div>
  );
}

export function App() {
  return <ThemeProvider><div className="app"><AdminBanner /><Shell /></div></ThemeProvider>;
}
