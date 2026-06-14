// Renderer theme packs (mirror of packages/desktop/src/theme.ts, palette tuned to CSS vars).
// Users add a Theme and select it at runtime — the whole UI re-skins.
export interface Theme {
  id: string; name: string;
  agents: Record<string, string>;
  labels: Record<string, string>;
  palette: Record<string, string>;
}

const baseLabels = { floor: 'Bridge', task: 'Mission', auditFeed: 'Activity log' };

export const FLEET: Theme = {
  id: 'fleet', name: 'Fleet',
  agents: { michael: 'Captain Mykel', dwight: 'First Officer', toby: 'Oh Brian', hank: 'Constable Gooey', pam: 'D8A', worker: 'Deck Crew' },
  labels: baseLabels,
  palette: { bg: '#070b16', panel: '#0d1426', panel2: '#111b33', line: '#1e2c4a', ink: '#e8eefc', muted: '#8aa0c8', accent: '#37d6ff', accent2: '#ffce5c', ok: '#39d98a', warn: '#ffce5c', deny: '#ff5c7a', ask: '#b48cff', chip: '#13203c' },
};

export const OPS: Theme = {
  id: 'ops', name: 'Ops (neutral)',
  agents: { michael: 'Orchestrator', dwight: 'Planner', toby: 'Intake', hank: 'Monitor', pam: 'Memory', worker: 'Worker' },
  labels: { floor: 'Dashboard', task: 'Task', auditFeed: 'Audit' },
  palette: { bg: '#0f1115', panel: '#171a21', panel2: '#1c212b', line: '#2a313d', ink: '#eef1f5', muted: '#9aa6b6', accent: '#5db0ff', accent2: '#7bd88f', ok: '#7bd88f', warn: '#f0c24b', deny: '#ff6b6b', ask: '#b98bff', chip: '#222834' },
};

export const THEMES: Theme[] = [FLEET, OPS];
export function displayName(t: Theme, id: string): string { return t.agents[id] ?? id; }
