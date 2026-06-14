import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, TaskLedger, classifyNode, promoteCluster, GovernanceError } from './index';
import type { CanvasNode } from './index';

const ledger = () => new TaskLedger(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-pam-')), 'a.jsonl')));

describe('TC-8.1 — promote yields backlog drafts only (nothing dispatched)', () => {
  it('every produced task is in backlog and linked to its source node', () => {
    const nodes: CanvasNode[] = [
      { id: 'n1', text: 'Build a grants-matching report generator for clients' },
      { id: 'n2', text: 'Add a scoring step that ranks grants by fit' },
    ];
    const r = promoteCluster(nodes, ledger());
    expect(r.drafts.length).toBeGreaterThan(0);
    expect(r.drafts.every((t) => t.status === 'backlog')).toBe(true);          // never dispatched
    expect(r.drafts.some((t) => t.subject.includes('node:n1'))).toBe(true);    // linked to source
  });
  it('a multi-item work cluster gets a parent task (DAG)', () => {
    const r = promoteCluster([
      { id: 'a', text: 'Scrape the grants source pages' },
      { id: 'b', text: 'Build the matcher engine over the scraped data' },
    ], ledger());
    expect(r.drafts.some((t) => t.subject.startsWith('[cluster]'))).toBe(true);
    expect(r.drafts.some((t) => t.parentId)).toBe(true);
  });
});

describe('TC-8.2 — node classification routes correctly', () => {
  it('a capability idea routes to Toby intake (evaluation)', () => {
    expect(classifyNode({ id: 'x', text: 'a new MCP connector for HubSpot' }).route).toBe('intake');
    const r = promoteCluster([{ id: 'x', text: 'add a skill that summarizes PDFs' }], ledger());
    expect(r.intake.length).toBe(1);
    expect(r.intake[0].type).toBe('evaluation');
  });
  it('a workflow idea becomes a workflow draft; a vague note becomes a question', () => {
    expect(classifyNode({ id: 'w', text: 'a recurring weekly reporting workflow' }).route).toBe('workflow');
    const r = promoteCluster([{ id: 'v', text: 'maybe?' }], ledger());
    expect(r.questions.length).toBe(1);
    expect(r.drafts.length).toBe(0);
  });
});

describe('TC-8.3 — Pam is generative, not executive (governance holds)', () => {
  it('Pam cannot move her own draft out of backlog (proposer != approver)', () => {
    const L = ledger();
    const r = promoteCluster([{ id: 'n', text: 'Write the onboarding guide for the product' }], L);
    const draft = r.drafts.find((t) => t.subject.includes('node:n'))!;
    expect(() => L.transition(draft.id, 'analysis', 'pam')).toThrow(GovernanceError);   // needs human/orchestrator
    expect(L.transition(draft.id, 'analysis', 'god').status).toBe('analysis');
  });
});
