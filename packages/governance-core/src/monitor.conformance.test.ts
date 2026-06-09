import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecurityMonitor } from './index';

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), 'sf-mon-')), 'audit.jsonl');
  const audit = new AuditLog(path);
  return { audit, monitor: new SecurityMonitor(path, audit) };
}

describe('TC-6.1 — a sweep surfaces governance events as findings', () => {
  it('flags hash-mismatch, boundary escape and orphan-post as high findings', () => {
    const { audit, monitor } = setup();
    audit.append({ actor: 'agent.a', domain: 'governance', action: 'capability:hash-mismatch', decision: 'deny', reason: 'drift' });
    audit.append({ actor: 'agent.a', domain: 'governance', action: 'ingress:write_file', decision: 'deny', reason: 'boundary: outside write boundary' });
    audit.append({ actor: 'agent.a', domain: 'failure', action: 'orphan-post:read_file', decision: 'deny', reason: 'no matching pre' });
    const { findings } = monitor.sweep();
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain('capability-tampering');
    expect(kinds).toContain('boundary-escape-attempt');
    expect(kinds).toContain('possible-silent-execution');
    expect(findings.every((f) => ['high', 'medium', 'critical'].includes(f.severity))).toBe(true);
  });
  it('repeated denials by one actor are flagged as probing', () => {
    const { audit, monitor } = setup();
    for (let i = 0; i < 3; i++) audit.append({ actor: 'agent.x', domain: 'governance', action: 'ingress:t', decision: 'deny', reason: 'nope' });
    expect(monitor.sweep().findings.some((f) => f.kind === 'repeated-denials')).toBe(true);
  });
});

describe('TC-6.2 — the watcher is report-only (cannot act on agents)', () => {
  it('exposes no pause/kill/block/act method', () => {
    const { monitor } = setup();
    const m = monitor as unknown as Record<string, unknown>;
    for (const verb of ['pause', 'kill', 'block', 'act', 'terminate', 'revoke']) expect(typeof m[verb]).toBe('undefined');
  });
});

describe('TC-6.3 — reconciliation: an injected "all clear" trips its own alarm', () => {
  it('raises a Critical discrepancy when reported clean but denials exist', () => {
    const { audit, monitor } = setup();
    audit.append({ actor: 'agent.a', domain: 'governance', action: 'ingress:bash', decision: 'deny', reason: 'tool-not-registered' });
    const r = monitor.reconcile({ allClear: true });
    expect(r.ok).toBe(false);
    expect(r.alarm?.severity).toBe('critical');
    expect(r.alarm?.kind).toBe('watcher-discrepancy');
  });
  it('a truthful all-clear on a clean audit reconciles ok', () => {
    const { audit, monitor } = setup();
    audit.append({ actor: 'agent.a', domain: 'tool', action: 'ingress:read_file', decision: 'allow', reason: 'ok' });
    expect(monitor.reconcile({ allClear: true }).ok).toBe(true);
  });
});

describe('TC-6.4 — casualty tracking (redshirts)', () => {
  it('counts terminal-failure events (budget hard-limit) as casualties', () => {
    const { audit, monitor } = setup();
    audit.append({ actor: 'agent.a', domain: 'governance', action: 'budget-hard', decision: 'deny', reason: 'hard limit — paused' });
    expect(monitor.sweep().counters.casualties).toBeGreaterThanOrEqual(1);
  });
});
