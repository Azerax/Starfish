import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, CapabilityLedger, Registry, PDP, vet, readSkillFiles, fileIntegrityGate, boundaryForSkill, skillWorkspaceLayout } from './index';
import type { ToolDef, AgentDef } from './index';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sf-int-'));
  const { source } = skillWorkspaceLayout(root, 'demo');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), 'safe instructions');
  writeFileSync(join(source, 'helper.py'), 'print(1)');
  const audit = new AuditLog(join(root, 'audit.jsonl'));
  const ledger = new CapabilityLedger(audit);
  ledger.intake(vet({ id: 'demo', kind: 'skill', files: readSkillFiles(source), provenance: { repo: 'anthropics/skills' } }));
  return { root, source, auditPath: join(root, 'audit.jsonl'), ledger };
}

describe('skill integrity — verify before invoke; tamper => quarantine', () => {
  it('passes when bytes are unchanged', () => {
    const { ledger, root } = setup();
    const gate = fileIntegrityGate(ledger, root);
    expect(gate.verify('demo').ok).toBe(true);
    expect(ledger.isEnabled('demo')).toBe(true);
  });

  it('flipping one byte names the file, denies, and auto-quarantines (Critical audit)', () => {
    const { ledger, root, source, auditPath } = setup();
    const gate = fileIntegrityGate(ledger, root);
    expect(gate.verify('demo').ok).toBe(true);
    writeFileSync(join(source, 'helper.py'), 'print(2)');   // external modification
    const r = gate.verify('demo');
    expect(r.ok).toBe(false);
    expect(r.changed).toContain('helper.py');
    expect(ledger.isEnabled('demo')).toBe(false);            // auto-quarantined
    const events = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; riskTier?: string; decision?: string });
    const tamper = events.find((e) => e.action === 'capability:tamper');
    expect(tamper?.riskTier).toBe('critical');
    expect(tamper?.decision).toBe('deny');
  });

  it('PDP denies an invocation of a tampered skill (verify-before-invoke)', () => {
    const { ledger, root, source } = setup();
    const toolsFile = join(root, 'tools.json'); writeFileSync(toolsFile, JSON.stringify([{ id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' } as ToolDef]));
    const agentsFile = join(root, 'agents.json'); writeFileSync(agentsFile, JSON.stringify([{ id: 'agent.a' } as AgentDef]));
    const tools = new Registry<ToolDef>(toolsFile, (t) => t.id);
    const agents = new Registry<AgentDef>(agentsFile, (a) => a.id);
    const audit = new AuditLog(join(root, 'audit2.jsonl'));
    const pdp = new PDP(tools, agents, audit, undefined, undefined, undefined, fileIntegrityGate(ledger, root));
    const bs = boundaryForSkill({ skillsRoot: root, skillId: 'demo' });
    const call = { agentId: 'agent.a', tool: 'fs.read', input: { path: join(source, 'SKILL.md') }, capabilityId: 'demo' };

    expect(pdp.decide('ingress', call, bs).allow).toBe(true);   // clean → allowed
    writeFileSync(join(source, 'SKILL.md'), 'tampered!');
    const d = pdp.decide('ingress', call, bs);
    expect(d.allow).toBe(false);
    expect(d.reason).toContain('integrity');
    expect(d.riskTier).toBe('critical');
  });
});
