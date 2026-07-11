// Renderer theme packs. A Theme supplies agent display names, labels, and a colour palette (light +
// optional dark). The default is CALM — a neutral, professional, token-driven skin. Fleet is an
// optional skin, off by default. Selecting a skin re-skins the whole UI via CSS vars; the light/dark
// mode picks palette vs paletteDark. (Mirrors packages/desktop/src/theme.ts at the data level.)
export interface Theme {
  id: string; name: string;
  agents: Record<string, string>;
  labels: Record<string, string>;
  palette: Record<string, string>;
  paletteDark?: Record<string, string>;
}

const baseLabels = { floor: 'Bridge', task: 'Task', auditFeed: 'Activity log' };
const opsAgents = { michael: 'Orchestrator', dwight: 'Planner', toby: 'Intake', hank: 'Monitor', pam: 'Memory', custodian: 'Custodian', worker: 'Worker' };

// Neutral, calm, professional — the shipped default.
export const CALM: Theme = {
  id: 'calm', name: 'Calm (default)',
  agents: opsAgents,
  labels: baseLabels,
  palette: { bg: '#f6f6f4', panel: '#ffffff', panel2: '#fafaf8', line: '#e6e5e1', ink: '#1b1b19', muted: '#6c6c66', accent: '#3f6fd8', accent2: '#3f6fd8', ok: '#1a7f4b', warn: '#8a6300', deny: '#b3261e', ask: '#6a4bb3', chip: '#f0efeb' },
  paletteDark: { bg: '#161719', panel: '#1e2024', panel2: '#24262b', line: '#33363c', ink: '#e9eaec', muted: '#a2a5ad', accent: '#6f9bff', accent2: '#6f9bff', ok: '#4ec98a', warn: '#e0b24b', deny: '#ff6b6b', ask: '#b98bff', chip: '#2a2d33' },
};

// Neutral dark (an alternate professional skin).
export const OPS: Theme = {
  id: 'ops', name: 'Ops (dark)',
  agents: opsAgents,
  labels: { floor: 'Dashboard', task: 'Task', auditFeed: 'Audit' },
  palette: { bg: '#0f1115', panel: '#171a21', panel2: '#1c212b', line: '#2a313d', ink: '#eef1f5', muted: '#9aa6b6', accent: '#5db0ff', accent2: '#5db0ff', ok: '#7bd88f', warn: '#f0c24b', deny: '#ff6b6b', ask: '#b98bff', chip: '#222834' },
};

// Fun personal skin — the Fleet crew. Off by default; selectable.
export const FLEET: Theme = {
  id: 'fleet', name: 'Fleet (skin)',
  agents: { michael: 'Captain Mykel', dwight: 'First Officer', toby: 'Oh Brian', hank: 'Constable Gooey', pam: 'D8A', custodian: 'Quartermaster', worker: 'Deck Crew' },
  labels: { floor: 'Bridge', task: 'Mission', auditFeed: 'Activity log' },
  palette: { bg: '#070b16', panel: '#0d1426', panel2: '#111b33', line: '#1e2c4a', ink: '#e8eefc', muted: '#8aa0c8', accent: '#37d6ff', accent2: '#ffce5c', ok: '#39d98a', warn: '#ffce5c', deny: '#ff5c7a', ask: '#b48cff', chip: '#13203c' },
};

export const THEMES: Theme[] = [CALM, OPS, FLEET];
export function displayName(t: Theme, id: string): string { return t.agents[id] ?? id; }
