import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { THEMES, type Theme } from './themes';

type Mode = 'light' | 'dark';
interface ThemeCtx {
  theme: Theme; themes: Theme[]; setThemeId: (id: string) => void;
  mode: Mode; setMode: (m: Mode) => void; toggleMode: () => void;
  canToggle: boolean;   // false for skins that ship a single (dark) palette
}
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setThemeId] = useState<string>(THEMES[0].id);   // Calm (neutral, light) is the default
  const [mode, setMode] = useState<Mode>('light');
  const theme = useMemo(() => THEMES.find((t) => t.id === id) ?? THEMES[0], [id]);
  const canToggle = !!theme.paletteDark;

  useEffect(() => {
    const root = document.documentElement;
    const dark = canToggle ? mode === 'dark' : true;   // single-palette skins (Fleet/Ops) are dark
    const pal = dark && theme.paletteDark ? theme.paletteDark : theme.palette;
    for (const [k, v] of Object.entries(pal)) root.style.setProperty(`--${k}`, v);
    root.setAttribute('data-mode', dark ? 'dark' : 'light');
  }, [theme, mode, canToggle]);

  const toggleMode = () => setMode((m) => (m === 'light' ? 'dark' : 'light'));
  return <Ctx.Provider value={{ theme, themes: THEMES, setThemeId, mode, setMode, toggleMode, canToggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
