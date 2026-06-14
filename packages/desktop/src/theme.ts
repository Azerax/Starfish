// Theme-pack (ring 3) — data-driven, IP-safe. The DISTRIBUTED "Fleet" theme maps internal agent
// ids to display personas and supplies labels/palette. No trademarked tokens (CI IP-scan enforces).
// A closer personal skin is just another Theme object swapped in; nothing here touches governance.
export interface Theme {
  id: string; shipName: string; org: string; admiral: string;
  agents: Record<string, string>;
  labels: Record<string, string>;
  palette: Record<string, string>;
}

export const FLEET: Theme = {
  id: 'fleet',
  shipName: 'GCS Starfish',
  org: 'Galactic Command',
  admiral: 'Grand Admiral Scotticus',
  agents: { michael: 'Captain Mykel', dwight: 'First Officer', toby: 'Oh Brian', hank: 'Constable Gooey', pam: 'D8A', worker: 'Deck Crew' },
  labels: { floor: 'Bridge', task: 'Mission', skillInvocation: 'PADD order', reasoningRequest: 'COMMS request', auditFeed: 'Activity log', escalation: 'Awaiting Galactic Command', casualty: 'redshirt down', transporterRoom: 'Transporter Room', addCapability: 'request to beam aboard', vetting: 'transporter scan', quarantine: 'held in the transporter buffer', registered: 'beamed aboard' },
  palette: { command: '#F2A23C', sciences: '#8699FF', security: '#D24C4C', ops: '#5FC98A', bg: '#0A0A0B' },
};

export function displayName(theme: Theme, internalId: string): string { return theme.agents[internalId] ?? internalId; }
export function label(theme: Theme, key: string): string { return theme.labels[key] ?? key; }
