import type { ReactElement } from 'react';
import type { PendingItem, MonitorView } from '../httpBridge';

export type ThemeId = 'calm' | 'vault' | 'radar' | 'terminal' | 'command';
export interface ThemePanelProps {
  items: PendingItem[];
  monitor?: MonitorView | null;
  onResolve: (id: string, verdict: 'approve' | 'deny') => void;
}
export interface ThemeDef { id: ThemeId; label: string; Component: (p: ThemePanelProps) => ReactElement }
export const anomalies = (m?: MonitorView | null): number =>
  m ? m.counters.boundaryEscapes + m.counters.hashMismatches + m.counters.budgetHard + m.counters.orphanPosts : 0;
