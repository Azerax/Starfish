import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from './registry';
import { intakeRoute } from './intake';
import type { ToolDef } from './types';

function tools(): Registry<ToolDef> {
  const f = join(mkdtempSync(join(tmpdir(), 'sf-intk-')), 'tools.json');
  writeFileSync(f, JSON.stringify([{ id: 'chroma_search', category: 'read', pathParams: [], allowedAgents: '*' }]));
  return new Registry<ToolDef>(f, (t) => t.id);
}

describe('TC-3.7 — intake routing (PADD vs COMMS vs new-capability)', () => {
  it('a registered skill routes to the deterministic (PADD) path', () => {
    expect(intakeRoute({ tool: 'chroma_search' }, tools()).route).toBe('skill');
  });
  it('open-ended work routes to a reasoning (COMMS) mission', () => {
    expect(intakeRoute({ text: 'research OCI grants for this company' }, tools()).route).toBe('reasoning');
  });
  it('a new-capability request routes to vetting (Toby)', () => {
    const r = intakeRoute({ requestNewCapability: true }, tools());
    expect(r.route).toBe('new-capability'); expect(r.taskType).toBe('evaluation');
  });
});
