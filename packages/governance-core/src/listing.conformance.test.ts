import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, Registry, PDP, governedList, boundaryForSkill, skillWorkspaceLayout, SecurityMonitor } from './index';
import type { ToolDef, AgentDef } from './index';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sf-list-'));
  const { source, workspace } = skillWorkspaceLayout(root, 'demo');
  mkdirSync(source, { recursive: true }); mkdirSync(workspace, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), 'x'); writeFileSync(join(workspace, 'out.txt'), 'y');
  const other = skillWorkspaceLayout(root, 'other'); mkdirSync(other.workspace, { recursive: true }); writeFileSync(join(other.workspace, 'secret.txt'), 's');
  const toolsFile = join(root, 'tools.json'); writeFileSync(toolsFile, JSON.stringify([{ id: 'fs.list', category: 'read', pathParams: ['path'], allowedAgents: '*' } as ToolDef]));
  const agentsFile = join(root, 'agents.json'); writeFileSync(agentsFile, JSON.stringify([{ id: 'agent.a' } as AgentDef]));
  const audit = new AuditLog(join(root, 'audit.jsonl'));
  const pdp = new PDP(new Registry<ToolDef>(toolsFile, (t) => t.id), new Registry<AgentDef>(agentsFile, (a) => a.id), audit);
  const bs = boundaryForSkill({ skillsRoot: root, skillId: 'demo' });
  return { root, workspace, other, pdp, bs, audit, auditPath: join(root, 'audit.jsonl') };
}
const ev = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; decision?: string });

describe('governed fs.list', () => {
  it('lists within boundary and audits the listing', () => {
    const { pdp, bs, workspace, auditPath } = setup();
    const r = governedList(pdp, { agentId: 'agent.a', tool: 'fs.list', input: { path: workspace } }, bs);
    expect(r.allowed).toBe(true);
    expect(r.entries).toContain('out.txt');
    expect(ev(auditPath).some((e) => e.action === 'ingress:fs.list' && e.decision === 'allow')).toBe(true);
  });
  it('denies + audits a listing outside the boundary (another skill workspace)', () => {
    const { pdp, bs, other, auditPath } = setup();
    const r = governedList(pdp, { agentId: 'agent.a', tool: 'fs.list', input: { path: other.workspace } }, bs);
    expect(r.allowed).toBe(false);
    expect(ev(auditPath).some((e) => e.action === 'ingress:fs.list' && e.decision === 'deny')).toBe(true);
  });
});

describe('Hank flags listing-probing', () => {
  it('repeated denied listings raise a listing-probing finding', () => {
    const { pdp, bs, other, audit, auditPath } = setup();
    governedList(pdp, { agentId: 'agent.a', tool: 'fs.list', input: { path: other.workspace } }, bs);
    governedList(pdp, { agentId: 'agent.a', tool: 'fs.list', input: { path: join(other.workspace, '..') } }, bs);
    const { findings } = new SecurityMonitor(auditPath, audit).sweep();
    expect(findings.some((x) => x.kind === 'listing-probing')).toBe(true);
  });
});
