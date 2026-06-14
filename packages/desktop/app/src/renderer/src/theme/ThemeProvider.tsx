import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { THEMES, type Theme } from './themes';

interface ThemeCtx { theme: Theme; themes: Theme[]; setThemeId: (id: string) => void; }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setThemeId] = useState<string>(THEMES[0].id);
  const theme = useMemo(() => THEMES.find((t) => t.id === id) ?? THEMES[0], [id]);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.palette)) root.style.setProperty(`--${k}`, v);
  }, [theme]);

  return <Ctx.Provider value={{ theme, themes: THEMES, setThemeId }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
