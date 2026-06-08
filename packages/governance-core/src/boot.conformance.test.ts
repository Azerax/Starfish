import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor } from './boot';
import { Registry } from './registry';
import { GovernanceError, type ToolDef } from './types';

function gdir(withFiles = true): string {
  const d = mkdtempSync(join(tmpdir(), 'sf-gov-'));
  if (withFiles) {
    writeFileSync(join(d, 'tools.json'), JSON.stringify([]));
    writeFileSync(join(d, 'agents.json'), JSON.stringify([]));
  }
  return d;
}

describe('TC-1.6 — fail-closed boot', () => {
  it('throws when a required registry is missing (never governance-off)', () => {
    const d = gdir(false);
    expect(() => loadGovernor(d, join(d, 'audit.jsonl'))).toThrow(GovernanceError);
  });
  it('throws on a corrupt registry', () => {
    const d = gdir(true); writeFileSync(join(d, 'tools.json'), '{ not json');
    expect(() => loadGovernor(d, join(d, 'audit.jsonl'))).toThrow(GovernanceError);
  });
});

describe('TC-1.9 — single-source registry integrity', () => {
  it('detects an out-of-band edit (fail closed), then reloads on demand', () => {
    const d = gdir(true); const f = join(d, 'tools.json');
    const r = new Registry<ToolDef>(f, (t) => t.id);
    writeFileSync(f, JSON.stringify([{ id: 'sneaky', category: 'read', pathParams: [], allowedAgents: '*' }]));
    expect(() => r.verifyIntegrity()).toThrow(GovernanceError);
    r.reload();
    expect(r.get('sneaky')?.id).toBe('sneaky');
  });
});
