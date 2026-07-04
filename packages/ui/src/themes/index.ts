import type { ThemeDef } from './types';
import { CalmPanel } from './calm';
import { VaultPanel } from './vault';
import { RadarPanel } from './radar';
import { TerminalPanel } from './terminal';
import { CommandPanel } from './command';

export const THEMES: ThemeDef[] = [
  { id: 'calm', label: 'Calm (neutral default)', Component: CalmPanel },
  { id: 'vault', label: 'Vault (dual control)', Component: VaultPanel },
  { id: 'radar', label: 'Radar (approach control)', Component: RadarPanel },
  { id: 'terminal', label: 'Terminal (dev-native)', Component: TerminalPanel },
  { id: 'command', label: 'Command (ops dashboard)', Component: CommandPanel },
];
export { CalmPanel, VaultPanel, RadarPanel, TerminalPanel, CommandPanel };
export type { ThemeId, ThemeDef, ThemePanelProps } from './types';
