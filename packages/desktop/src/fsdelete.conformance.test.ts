import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realFsProbe, TrashStore, governedCustodianDelete } from './index';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine, type ToolDef, type AgentDef, type BoundarySet, type DeletionConfig } from '@starfish/governance-core';

function ws() { return mkdtempSync(join(tmpdir(), 'sf-fsdel-')); }

describe('realFsProbe', () => {
  it('measures a tree (files + bytes), flags directories, never follows into symlinks', () => {
    const d = ws();
    mkdirSync(join(d, 'sub'));
    writeFileSync(join(d, 'a.txt'), 'hello');          // 5 bytes
    writeFileSync(join(d, 'sub', 'b.txt'), 'world!!');  // 7 bytes
    const probe = realFsProbe();
    expect(probe.isDirectory(d)).toBe(true);
    expect(probe.isDirectory(join(d, 'a.txt'))).toBe(false);
    const m = probe.measure(d, 1000);
    expect(m.files).toBe(2); expect(m.bytes).toBe(12); expect(m.truncated).toBe(false);
  });
  it('truncates at the cap', () => {
    const d = ws();
    for (let i = 0; i < 10; i++) writeFileSync(join(d, `f${i}`), 'x');
    expect(realFsProbe().measure(d, 3).truncated).toBe(true);
  });
});

describe('TrashStore — recoverable soft delete', () => {
  it('moves a file to trash (gone from source, recorded), then restores it', () => {
    const d = ws(); const trash = join(d, '.trash');
    const f = join(d, 'doc.txt'); writeFileSync(f, 'keep me');
    const store = new TrashStore(trash);
    const { id, trashPath } = store.move(f);
    expect(existsSync(f)).toBe(false);                  // gone from original
    expect(existsSync(trashPath)).toBe(true);           // present in trash
    expect(store.list().map((e) => e.id)).toContain(id);
    const r = store.restore(id);
    expect(r.ok).toBe(true); expect(existsSync(f)).toBe(true); expect(readFileSync(f, 'utf8')).toBe('keep me');
  });
  it('refuses to restore over an existing file', () => {
    const d = ws(); const f = join(d, 'x.txt'); writeFileSync(f, '1');
    const store = new TrashStore(join(d, '.trash'));
    const { id } = store.move(f);
    writeFileSync(f, 'replaced');                       // something new at the original path
    expect(store.restore(id).ok).toBe(false);
  });
  it('purge permanently removes an entry, and records it first', () => {
    const d = ws(); const f = join(d, 'y.txt'); writeFileSync(f, '1');
    const store = new TrashStore(join(d, '.trash'));
    const { id } = store.move(f);
    const audit = new AuditLog(join(d, 'audit.jsonl'));
    expect(store.purge(id, audit)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(audit.recent(10).some((e) => e.action === 'trash-purge' && e.target === id)).toBe(true);
  });
  // Q5 — the recovery store is what makes the whole soft-delete guarantee safe, so destroying it
  // must be as governed as the forward path. An unauditable purge is refused, not performed quietly.
  it('purge REFUSES when the destruction cannot be recorded', () => {
    const d = ws(); const f = join(d, 'z.txt'); writeFileSync(f, '1');
    const store = new TrashStore(join(d, '.trash'));
    const { id } = store.move(f);
    const broken = { append() { throw new Error('audit unavailable'); } } as unknown as AuditLog;
    expect(store.purge(id, broken)).toBe(false);
    expect(store.list().length).toBe(1);                 // still recoverable
  });
  it('purgeAll demands an explicit confirmation token', () => {
    const d = ws(); const f = join(d, 'w.txt'); writeFileSync(f, '1');
    const store = new TrashStore(join(d, '.trash'));
    store.move(f);
    const audit = new AuditLog(join(d, 'audit.jsonl'));
    expect(() => (store as unknown as { purgeAll(a: AuditLog, c: string): number }).purgeAll(audit, 'yes')).toThrow(/PURGE-ALL/);
    expect(store.list().length).toBe(1);
    expect(store.purgeAll(audit, 'PURGE-ALL')).toBe(1);
    expect(store.list()).toEqual([]);
  });
  it('refuses to trash a directory (hard rule belt-and-suspenders)', () => {
    const d = ws(); mkdirSync(join(d, 'folder'));
    expect(() => new TrashStore(join(d, '.trash')).move(join(d, 'folder'))).toThrow(/folder/i);
  });
});

describe('governedCustodianDelete — end-to-end soft delete', () => {
  it('soft-deletes a workspace file via the Custodian and it lands recoverable in trash', () => {
    const d = ws();
    const f = join(d, 'cleanup-me.log'); writeFileSync(f, 'temp');
    const trash = join(d, '.trash');
    writeFileSync(join(d, 'tools.json'), JSON.stringify([{ id: 'fs.delete', category: 'write', pathParams: ['path'], allowedAgents: ['custodian'] }] as ToolDef[]));
    writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'custodian' }] as AgentDef[]));
    const audit = new AuditLog(join(d, 'audit.jsonl'));
    const pdp = new PDP(new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id),
      audit, new RiskEngine(), new PolicyEngine([{ id: 'p', subject: 'agent:custodian', action: 'tool:fs.delete', resource: '*', effect: 'allow' }] as never));
    const bs: BoundarySet = { visibility: [d], write: [d] };
    const cfg: DeletionConfig = { projectRoot: d };
    const store = new TrashStore(trash);
    const r = governedCustodianDelete(pdp, { agentId: 'custodian', tool: 'fs.delete', input: { path: f } }, bs, { cfg, store, trashDir: trash, audit });
    expect(r.ok).toBe(true); expect(existsSync(f)).toBe(false); expect(store.list().length).toBe(1);
    expect(store.restore(store.list()[0].id).ok).toBe(true); expect(existsSync(f)).toBe(true);
  });
});
