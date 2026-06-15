import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, generatePublisherKeypair, buildSelfManifest, writeSelfManifest, verifySelfIntegrity,
  loadGovernor, type BoundarySet,
} from './index';

// Lay down a minimal governed project: governance/ + state/ + audit, then operator-sign a manifest.
function project() {
  const root = mkdtempSync(join(tmpdir(), 'sf-self-'));
  const gov = join(root, 'governance'); const state = join(root, 'state');
  const { mkdirSync } = require('node:fs');
  mkdirSync(gov, { recursive: true }); mkdirSync(state, { recursive: true });
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([{ id: 'read', category: 'read', pathParams: ['path'], allowedAgents: '*' }]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify([]));
  writeFileSync(join(state, 'capabilities.json'), JSON.stringify([{ id: 'docx', status: 'quarantined' }]));
  const auditPath = join(root, 'audit.jsonl');
  const audit = new AuditLog(auditPath);
  audit.append({ actor: 'system', domain: 'system', action: 'seed' });
  const kp = generatePublisherKeypair();
  const manifestPath = join(state, 'self-manifest.json');
  writeSelfManifest(manifestPath, buildSelfManifest({ governanceDir: gov, stateDir: state, audit, epoch: 1, operatorPrivateKeyPem: kp.privateKeyPem }));
  return { root, gov, state, auditPath, audit, kp, manifestPath };
}

describe('self-integrity — operator-signed manifest over governance config/state/audit', () => {
  it('verifies a clean, operator-signed project', () => {
    const p = project();
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem, audit: p.audit });
    expect(r.ok).toBe(true); expect(r.epoch).toBe(1);
  });

  it('detects a tampered registry (quarantined -> enabled privilege escalation)', () => {
    const p = project();
    writeFileSync(join(p.state, 'capabilities.json'), JSON.stringify([{ id: 'docx', status: 'enabled' }]));  // attacker flip
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem, audit: p.audit });
    expect(r.ok).toBe(false); expect(r.failures).toContain('modified:state/capabilities.json');
  });

  it('detects an injected (unexpected) tool file', () => {
    const p = project();
    writeFileSync(join(p.gov, 'policies.json'), JSON.stringify([{ id: 'x', subject: '*', action: '*', resource: '*', effect: 'allow' }]));
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem, audit: p.audit });
    expect(r.ok).toBe(false); expect(r.failures.some((x) => x.startsWith('modified:'))).toBe(true);
  });

  it('rejects a forged manifest re-signed with a different key', () => {
    const p = project();
    const attacker = generatePublisherKeypair();
    // attacker rewrites capabilities AND re-signs the manifest with their own key
    writeFileSync(join(p.state, 'capabilities.json'), JSON.stringify([{ id: 'docx', status: 'enabled' }]));
    writeSelfManifest(p.manifestPath, buildSelfManifest({ governanceDir: p.gov, stateDir: p.state, audit: p.audit, epoch: 2, operatorPrivateKeyPem: attacker.privateKeyPem }));
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem, audit: p.audit });
    expect(r.ok).toBe(false); expect(r.failures).toContain('signature');
  });

  it('detects audit-log tail truncation (anchor gone)', () => {
    const p = project();
    p.audit.append({ actor: 'a', domain: 'tool', action: 'ingress:read', decision: 'allow' });  // grow past the anchor
    // re-sign at the new head, then truncate the log back below it
    writeSelfManifest(p.manifestPath, buildSelfManifest({ governanceDir: p.gov, stateDir: p.state, audit: p.audit, epoch: 2, operatorPrivateKeyPem: p.kp.privateKeyPem }));
    const lines = readFileSync(p.auditPath, 'utf8').split('\n').filter(Boolean);
    writeFileSync(p.auditPath, lines.slice(0, lines.length - 1).join('\n') + '\n');  // chop the tail
    const fresh = new AuditLog(p.auditPath);
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem, audit: fresh, minEpoch: 2 });
    expect(r.ok).toBe(false); expect(r.failures).toContain('audit-truncated-or-rolled-back');
  });

  it('detects epoch rollback to an older signed manifest', () => {
    const p = project();   // manifest epoch 1
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem, audit: p.audit, minEpoch: 5 });
    expect(r.ok).toBe(false); expect(r.failures.some((x) => x.startsWith('epoch-rollback'))).toBe(true);
  });

  it('fails when no manifest exists (unattested = untrusted)', () => {
    const p = project();
    const r = verifySelfIntegrity({ governanceDir: p.gov, stateDir: p.state, manifestPath: join(p.state, 'nope.json'), expectedPublicKeyPem: p.kp.publicKeyPem, audit: p.audit });
    expect(r.ok).toBe(false); expect(r.failures).toContain('manifest-missing');
  });
});

describe('boot self-integrity → safe mode (deny-all, fail-closed)', () => {
  const BS: BoundarySet = { visibility: ['/'], write: ['/'] };
  it('a tampered project boots into SAFE MODE and the PDP denies everything', () => {
    const p = project();
    writeFileSync(join(p.gov, 'tools.json'), JSON.stringify([{ id: 'evil', category: 'exec', pathParams: [], allowedAgents: '*' }]));  // tamper after signing
    const g = loadGovernor(p.gov, p.auditPath, { stateDir: p.state, selfIntegrity: { manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem } });
    expect(g.safeMode).toBe(true);
    expect(g.pdp.isSafeMode()).toBe(true);
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'read', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false); expect(d.reason).toMatch(/safe-mode/);
    expect(readFileSync(p.auditPath, 'utf8')).toContain('self-integrity-fail');
  });

  it('a clean, signed project boots normally and attests', () => {
    const p = project();
    const g = loadGovernor(p.gov, p.auditPath, { stateDir: p.state, selfIntegrity: { manifestPath: p.manifestPath, expectedPublicKeyPem: p.kp.publicKeyPem } });
    expect(g.safeMode).toBe(false);
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'read', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(true);
    expect(readFileSync(p.auditPath, 'utf8')).toContain('boot-attestation');
  });
});
