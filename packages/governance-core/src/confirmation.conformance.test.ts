// H6 — distinct confirmation for critical asks (HARDENING_BACKLOG.md). The enforceable half: a pure
// class function that is monotone (nothing demotes a floor ask), the class carried on PendingDecision
// and derived rather than supplied, and the broker refusing a deliberate approval that lacks the
// confirmation. The PDP → broker path is tested end to end so the class is not just reachable in theory.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';
import { DecisionBroker } from './broker';
import { confirmationClass, confirmationPhrase } from './confirmation';
import { loadGovernor } from './boot';
import type { AskOrigin, BoundarySet, RiskTier } from './types';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'sf-confirm-'));
const TIERS: (RiskTier | undefined)[] = ['low', 'medium', 'high', 'critical', 'injection', undefined];
const ORIGINS: (AskOrigin | undefined)[] = ['risk', 'policy', 'floor', undefined];

describe('H6 — confirmationClass', () => {
  it('is deliberate for a floor ask at ANY tier, and for critical, injection or an unknown tier', () => {
    for (const riskTier of TIERS) {
      for (const askOrigin of ORIGINS) {
        const c = confirmationClass({ riskTier, askOrigin });
        const mustBeDeliberate = askOrigin === 'floor' || riskTier === 'critical' || riskTier === 'injection' || riskTier === undefined;
        expect(c, `${riskTier}/${askOrigin}`).toBe(mustBeDeliberate ? 'deliberate' : 'routine');
      }
    }
  });

  it('routine approvals stay one step: low/medium/high risk or policy asks are routine', () => {
    expect(confirmationClass({ riskTier: 'high', askOrigin: 'risk' })).toBe('routine');
    expect(confirmationClass({ riskTier: 'low', askOrigin: 'policy' })).toBe('routine');
    expect(confirmationClass({ riskTier: 'medium' })).toBe('routine');
  });

  it('the phrase is the tool label', () => {
    expect(confirmationPhrase({ tool: 'Bash' })).toBe('Bash');
  });
});

describe('H6 — the broker enforces it', () => {
  const broker = (): { b: DecisionBroker; dir: string; audit: AuditLog } => {
    const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl'));
    return { b: new DecisionBroker(audit, join(dir, 'decisions.json')), dir, audit };
  };

  it('a deliberate decision cannot be approved by a routine request, and the refusal does not leak the phrase', () => {
    const { b } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', target: 'drop table users', riskTier: 'critical', askOrigin: 'floor', reason: 'floor 6' });
    expect(d.confirmation).toBe('deliberate');
    const r = b.resolve(d.id, 'approve', 'operator');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/deliberate confirmation required/);
    expect(r.reason).not.toContain('"shell"');
    expect(b.has(d.id)).toBe(true);                                         // still pending
    expect(b.resolve(d.id, 'approve', 'operator', undefined, { confirm: 'shel' }).ok).toBe(false);   // wrong phrase
  });

  it('with the phrase it is approved, and the audit records that it was deliberate', () => {
    const { b, audit } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', riskTier: 'critical', reason: 'critical' });
    expect(b.resolve(d.id, 'approve', 'operator', undefined, { confirm: 'shell' }).ok).toBe(true);
    expect(audit.recent(5).find((e) => e.action === 'decision:approved')?.reason).toMatch(/deliberate confirmation/);
  });

  it('deny is never gated', () => {
    const { b } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', riskTier: 'critical', askOrigin: 'floor', reason: 'x' });
    expect(b.resolve(d.id, 'deny', 'operator').ok).toBe(true);
  });

  it('a routine decision is still one step', () => {
    const { b } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', riskTier: 'high', askOrigin: 'risk', reason: 'x' });
    expect(d.confirmation).toBe('routine');
    expect(b.resolve(d.id, 'approve', 'operator').ok).toBe(true);
  });

  it('a caller cannot demote a floor ask by supplying confirmation:"routine"', () => {
    const { b } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', riskTier: 'high', askOrigin: 'floor', reason: 'x', confirmation: 'routine' } as never);
    expect(d.confirmation).toBe('deliberate');
    expect(b.resolve(d.id, 'approve', 'operator').ok).toBe(false);
  });

  it('an edited persist file cannot demote it either: the class is re-derived on restore', () => {
    const { b, dir, audit } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', riskTier: 'critical', reason: 'x' });
    const p = join(dir, 'decisions.json');
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { pending: Array<Record<string, unknown>> };
    raw.pending[0].confirmation = 'routine';
    writeFileSync(p, JSON.stringify(raw));
    const b2 = new DecisionBroker(audit, p);
    expect(b2.get(d.id)?.confirmation).toBe('deliberate');
    expect(b2.resolve(d.id, 'approve', 'operator').ok).toBe(false);
  });

  it('proposer != approver still comes first: the agent cannot self-approve even with the phrase', () => {
    const { b } = broker();
    const d = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', riskTier: 'critical', reason: 'x' });
    expect(b.resolve(d.id, 'approve', 'worker', undefined, { confirm: 'shell' }).reason).toMatch(/proposer != approver/);
  });
});

describe('H6 — wiring: a PDP floor ask reaches the broker as deliberate', () => {
  it('askOrigin survives from the PDP decision to the pending record', () => {
    const d0 = tmp(); const g = join(d0, 'governance'); mkdirSync(g, { recursive: true });
    writeFileSync(join(g, 'tools.json'), JSON.stringify([
      { id: 'shell', category: 'exec', pathParams: [], allowedAgents: '*' },
      { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' },
    ]));
    writeFileSync(join(g, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
    writeFileSync(join(g, 'policies.json'), JSON.stringify([]));
    const gov = loadGovernor(g, join(d0, 'audit.jsonl'));
    const bs: BoundarySet = { visibility: [d0], write: [d0] };
    const b = new DecisionBroker(gov.audit);

    const floor = gov.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'psql -c "drop table users"' } }, bs);
    expect(floor.ask).toBe(true);
    expect(floor.askOrigin).toBe('floor');
    const parked = b.file({ actor: 'worker', kind: 'tool', tool: 'shell', riskTier: floor.riskTier, askOrigin: floor.askOrigin, reason: floor.reason });
    expect(parked.confirmation).toBe('deliberate');

    const routine = gov.pdp.decide('ingress', { agentId: 'worker', tool: 'fs.write', input: { path: join(d0, 'f.txt'), content: 'x' } }, bs);
    expect(routine.ask).toBe(true);
    expect(routine.askOrigin).toBe('risk');
    expect(b.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', riskTier: routine.riskTier, askOrigin: routine.askOrigin, reason: routine.reason }).confirmation).toBe('routine');
  });
});
