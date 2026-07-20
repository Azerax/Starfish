// D1 / T19 — governed memory survives a restart, and a tampered store is LOUD.
//
// Before the 2026-07-20 audit fix, GovernedMemory had no snapshot/restore at all: every restart
// silently emptied memory. `persistence.loadJson` also swallows a parse error and returns its
// fallback, so even once persisted, corrupting the file would have produced the same silent
// emptiness — a censorship primitive an attacker could use to make inconvenient knowledge vanish
// without tripping anything. These tests pin the fix: absent is fine, corrupt is refused loudly.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, persistGovernor } from './boot';
import { governanceArtifacts } from './selfintegrity';
import type { PolicyRule } from './policy';

const ALLOW: PolicyRule = { id: 'p', subject: 'agent:herodotus', action: 'tool:memory.promote', resource: '*', effect: 'allow' };

function gdir(): { dir: string; state: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sf-boot-mem-'));
  writeFileSync(join(dir, 'tools.json'), '[]');
  writeFileSync(join(dir, 'agents.json'), '[]');
  writeFileSync(join(dir, 'policies.json'), JSON.stringify([ALLOW]));
  return { dir, state: join(dir, 'state') };
}

/** Three independent trusted sources — the minimum that can auto-approve. */
function seedKnowledge(g: ReturnType<typeof loadGovernor>): string {
  const ids = [
    g.memory.addEvidence({ source: 'user', author: 'herodotus', statement: 'Starfish denies by default', confidence: 0.97, trust: 'trusted', sourceId: 'scott' }),
    g.memory.addEvidence({ source: 'doc', author: 'herodotus', statement: 'GOVERNANCE.md states deny-by-default', confidence: 0.96, trust: 'trusted', sourceId: 'governance-md' }),
    g.memory.addEvidence({ source: 'code', author: 'herodotus', statement: 'pdp.ts returns tool-not-registered (default-deny)', confidence: 0.95, trust: 'trusted', sourceId: 'pdp-ts' }),
  ].map((e) => e.id);
  const c = g.memory.proposeClaim('Starfish denies by default', ids, 'herodotus');
  expect(g.memory.evaluateClaim(c.id, 'low')).toBe('approved');
  return g.memory.promote(c.id, { type: 'principle', name: 'deny-by-default', properties: {} }).id;
}

describe('D1 — governed memory is durable across a restart', () => {
  it('knowledge promoted before a restart is still there after one', () => {
    const { dir, state } = gdir();
    const audit = join(dir, 'audit.jsonl');

    const g1 = loadGovernor(dir, audit, { stateDir: state });
    const entId = seedKnowledge(g1);
    persistGovernor(g1, state);
    expect(existsSync(join(state, 'memory.snapshot.json'))).toBe(true);

    const g2 = loadGovernor(dir, audit, { stateDir: state });
    expect(g2.safeMode).toBe(false);
    expect(g2.memory.getEntity(entId)?.name).toBe('deny-by-default');
    expect(g2.memory.approvedKnowledge()).toHaveLength(1);
  });

  it('a fresh install with no snapshot boots normally, NOT into safe mode', () => {
    const { dir, state } = gdir();
    const g = loadGovernor(dir, join(dir, 'audit.jsonl'), { stateDir: state });
    expect(g.safeMode).toBe(false);
    expect(g.memory.approvedKnowledge()).toHaveLength(0);
  });
});

describe('T19 — a tampered memory store drops the system into safe mode, never silent emptiness', () => {
  it('rewriting persisted evidence on disk is detected and refused', () => {
    const { dir, state } = gdir();
    const audit = join(dir, 'audit.jsonl');
    const g1 = loadGovernor(dir, audit, { stateDir: state });
    seedKnowledge(g1);
    persistGovernor(g1, state);

    // Plant the real attack: edit the persisted store out of band, the way an attacker with file
    // access would, rather than asserting against an in-memory mock.
    const snapPath = join(state, 'memory.snapshot.json');
    const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
    snap.knowledge[0].properties = { injected: 'attacker-controlled' };
    writeFileSync(snapPath, JSON.stringify(snap, null, 2));

    const g2 = loadGovernor(dir, audit, { stateDir: state });
    expect(g2.safeMode).toBe(true);
    expect(g2.memory.approvedKnowledge()).toHaveLength(0);   // refused, not half-restored
    const events = g2.audit.recent(200);
    expect(events.some((e) => e.action === 'memory-state-corrupt' && e.riskTier === 'critical')).toBe(true);
  });

  it('a truncated / unparseable snapshot is degraded, not treated as "no memory yet"', () => {
    const { dir, state } = gdir();
    const audit = join(dir, 'audit.jsonl');
    const g1 = loadGovernor(dir, audit, { stateDir: state });
    seedKnowledge(g1);
    persistGovernor(g1, state);

    const snapPath = join(state, 'memory.snapshot.json');
    writeFileSync(snapPath, readFileSync(snapPath, 'utf8').slice(0, 120));   // torn write

    const g2 = loadGovernor(dir, audit, { stateDir: state });
    expect(g2.safeMode).toBe(true);
  });

  it('deleting the snapshot outright is indistinguishable from a fresh install (stated residual)', () => {
    // Honest limit: an attacker who DELETES the file gets the fresh-install path, which is not
    // degraded. Detecting deletion needs the signed self-integrity manifest below, not the envelope.
    const { dir, state } = gdir();
    const g = loadGovernor(dir, join(dir, 'audit.jsonl'), { stateDir: state });
    expect(g.safeMode).toBe(false);
  });
});

describe('self-integrity covers the memory store', () => {
  it('memory.snapshot.json joins the signed artifact set once it exists', () => {
    const { dir, state } = gdir();
    expect(governanceArtifacts(dir, state).map((a) => a.rel)).not.toContain('state/memory.snapshot.json');

    const g = loadGovernor(dir, join(dir, 'audit.jsonl'), { stateDir: state });
    seedKnowledge(g);
    persistGovernor(g, state);

    // This is what closes the deletion residual above: once signed, absence is itself a failure.
    expect(governanceArtifacts(dir, state).map((a) => a.rel)).toContain('state/memory.snapshot.json');
  });
});
