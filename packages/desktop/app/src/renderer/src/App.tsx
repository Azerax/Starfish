import { useEffect, useState } from 'react';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import { displayName } from './theme/themes';
import { FleetBadge } from './theme/icons';
import { Bridge } from './screens/Bridge';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { getBridge } from './bridge/useBridge';

function Clock() {
  const [t, setT] = useState(() => new Date().toTimeString().slice(0, 8));
  useEffect(() => { const id = setInterval(() => setT(new Date().toTimeString().slice(0, 8)), 1000); return () => clearInterval(id); }, []);
  return <span className="pill mono"><span className="dot live" /> {t}</span>;
}

function Header({ onSettings }: { onSettings: () => void }) {
  const { theme, themes, setThemeId } = useTheme();
  return (
    <header className="topbar">
      <span className="badge-slot"><FleetBadge /></span>
      <div className="brand">GCS&nbsp;Starfish<small>{theme.labels.floor} · Mission Control</small></div>
      <div className="spacer" />
      <Clock />
      <span className="pill"><span className="dot" /> GOVERNED · fail-closed</span>
      <label className="pill">Theme&nbsp;
        <select value={theme.id} onChange={(e) => setThemeId(e.target.value)}>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <button className="pill" onClick={onSettings} title="Provider & model settings">⚙ Settings</button>
    </header>
  );
}

function Shell() {
  const [view, setView] = useState<'loading' | 'onboard' | 'bridge' | 'settings'>('loading');
  useEffect(() => { getBridge().getOnboarding().then((s) => setView(s.done ? 'bridge' : 'onboard')).catch(() => setView('onboard')); }, []);
  if (view === 'loading') return null;
  if (view === 'onboard') return <Onboarding onDone={() => setView('bridge')} />;
  if (view === 'settings') return <Settings onBack={() => setView('bridge')} />;
  return <><Header onSettings={() => setView('settings')} /><Bridge nameFor={displayName} /></>;
}

export function App() {
  return <ThemeProvider><div className="app"><Shell /></div></ThemeProvider>;
}
