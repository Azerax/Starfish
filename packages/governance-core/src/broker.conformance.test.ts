import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, DecisionBroker } from './index';

const tmp = () => mkdtempSync(join(tmpdir(), 'sf-broker-'));

describe('DecisionBroker — the human-in-the-loop seam', () => {
  it('files a pending decision and lists it', () => {
    const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl'));
    const b = new DecisionBroker(audit, join(dir, 'decisions.json'));
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'git_commit', reason: 'risk high', riskTier: 'high' });
    expect(b.list().map((p) => p.id)).toContain(d.id);
  });

  it('await() resolves when the operator approves', async () => {
    const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl'));
    const b = new DecisionBroker(audit, join(dir, 'decisions.json'));
    const p = b.await({ actor: 'worker', kind: 'tool', tool: 'git_commit', reason: 'risk high' });
    const id = b.list()[0].id;
    const r = b.resolve(id, 'approve', 'operator');
    expect(r.ok).toBe(true);
    await expect(p).resolves.toBe('approve');
  });

  it('ENFORCES proposer != approver — the proposing actor cannot self-approve', () => {
    const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl'));
    const b = new DecisionBroker(audit, join(dir, 'decisions.json'));
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'git_commit', reason: 'r' });
    const r = b.resolve(d.id, 'approve', 'worker');     // same actor
    expect(r.ok).toBe(false);
    expect(b.has(d.id)).toBe(true);                     // still pending
  });

  it('is idempotent on refId (a capability is only queued once)', () => {
    const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl'));
    const b = new DecisionBroker(audit, join(dir, 'decisions.json'));
    b.file({ actor: 'toby', kind: 'capability', tool: 'capability:vet', refId: 'web-search-mcp', reason: 'medium' });
    b.file({ actor: 'toby', kind: 'capability', tool: 'capability:vet', refId: 'web-search-mcp', reason: 'medium' });
    expect(b.list().filter((p) => p.refId === 'web-search-mcp').length).toBe(1);
  });

  it('persists pending decisions fail-closed across a restart (re-offered, not auto-approved)', () => {
    const dir = tmp(); const path = join(dir, 'decisions.json'); const audit = new AuditLog(join(dir, 'a.jsonl'));
    const b1 = new DecisionBroker(audit, path);
    const d = b1.file({ actor: 'worker', kind: 'tool', tool: 'git_commit', reason: 'r' });
    expect(existsSync(path)).toBe(true);
    const b2 = new DecisionBroker(audit, path);          // simulate restart
    expect(b2.has(d.id)).toBe(true);                     // still pending after restart
    expect(JSON.parse(readFileSync(path, 'utf8')).pending.length).toBe(1);
  });

  it('audits every filing and resolution', () => {
    const dir = tmp(); const apath = join(dir, 'a.jsonl'); const audit = new AuditLog(apath);
    const b = new DecisionBroker(audit, join(dir, 'decisions.json'));
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'git_commit', reason: 'r' });
    b.resolve(d.id, 'deny', 'operator');
    const actions = readFileSync(apath, 'utf8').trim().split('\n').map((l) => JSON.parse(l).action);
    expect(actions).toContain('decision:filed');
    expect(actions).toContain('decision:denied');
  });
});
