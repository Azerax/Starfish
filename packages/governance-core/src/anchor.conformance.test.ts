import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { merkleRoot, auditRoot, Anchorer, NoopAnchor, fileAnchor, customAnchor, AuditLog, type AuditEvent, type AnchorAdapter } from './index';

const evs = (n: number): AuditEvent[] => Array.from({ length: n }, (_, i) => ({ ts: 't', seq: i, prevHash: 'p', actor: 'a', domain: 'system', action: 'x', hash: 'h' + i } as AuditEvent));

describe('merkleRoot', () => {
  it('is deterministic and order/content sensitive', () => {
    expect(merkleRoot(['a', 'b', 'c'])).toBe(merkleRoot(['a', 'b', 'c']));
    expect(merkleRoot(['a', 'b', 'c'])).not.toBe(merkleRoot(['a', 'b', 'd']));   // tamper one leaf -> different root
    expect(merkleRoot(['a', 'b', 'c'])).not.toBe(merkleRoot(['a', 'c', 'b']));   // reorder -> different root
    expect(merkleRoot([])).toBe('EMPTY');
  });
});

describe('auditRoot', () => {
  it('fingerprints a range with a head pointer', () => {
    const r = auditRoot(evs(5));
    expect(r.count).toBe(5); expect(r.headSeq).toBe(4); expect(r.headHash).toBe('h4'); expect(r.root).not.toBe('EMPTY');
  });
});

describe('Anchorer — off by default (personal), opt-in (institution)', () => {
  it('does nothing and adds no overhead when disabled', async () => {
    const a = new Anchorer(NoopAnchor, { enabled: false });
    expect(a.enabled).toBe(false); expect(a.due(1000)).toBe(false);
    const r = await a.anchor(evs(3));
    expect(r.backend).toBe('noop');
  });

  it('commits a Merkle root to a local anchor file when enabled, chaining anchors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-anchor-'));
    const file = join(dir, 'anchors.jsonl');
    const audit = new AuditLog(join(dir, 'audit.jsonl'));
    const a = new Anchorer(fileAnchor(file), { enabled: true, everyNEvents: 2 }, audit);
    expect(a.enabled).toBe(true);
    return (async () => {
      const r1 = await a.anchor(evs(2));
      const r2 = await a.anchor(evs(4));
      expect(r1.ok && r2.ok).toBe(true);
      expect(existsSync(file)).toBe(true);
      const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.length).toBe(2);
      expect(lines[1].prevAnchor).toBe(r1.ref);                 // anchors chain to each other
      expect(readFileSync(join(dir, 'audit.jsonl'), 'utf8')).toContain('anchor-committed');
    })();
  });

  it('is best-effort: a notary failure is recorded and swallowed, never thrown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-anchor2-'));
    const audit = new AuditLog(join(dir, 'audit.jsonl'));
    const boom: AnchorAdapter = { id: 'boom', commit: () => { throw new Error('chain unreachable'); } };
    const a = new Anchorer(boom, { enabled: true }, audit);
    const r = await a.anchor(evs(3));
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/unreachable/);
    expect(readFileSync(join(dir, 'audit.jsonl'), 'utf8')).toContain('anchor-failed');   // recorded, not crashed
  });

  it('supports a custom backend (TSA / ledger / transparency log)', async () => {
    const published: string[] = [];
    const a = new Anchorer(customAnchor('ledger', (rec) => { published.push(rec.root); return 'tx:' + rec.root.slice(0, 8); }), { enabled: true });
    const r = await a.anchor(evs(2));
    expect(r.backend).toBe('ledger'); expect(r.ref).toMatch(/^tx:/); expect(published.length).toBe(1);
  });
});
