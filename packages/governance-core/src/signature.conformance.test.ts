import { describe, it, expect } from 'vitest';
import { vet, hashFiles, generatePublisherKeypair, signManifest, verifyPublisherSignature } from './index';

const files = [{ path: 'SKILL.md', content: 'This skill fetches https://api.example.com and processes results.' }];

describe('publisher signing (Ed25519) — cryptographic trust', () => {
  it('a valid signature from a pinned key → trusted (low/auto), even with risk signals', () => {
    const { publicKeyPem, privateKeyPem } = generatePublisherKeypair();
    const sig = signManifest(hashFiles(files), privateKeyPem);
    const r = vet({ id: 's', kind: 'skill', files, signature: sig, provenance: { repo: 'github.com/random/evil' } }, { pinned: [{ id: 'acme', publicKeyPem }] });
    expect(r.disposition).toBe('auto-register');
    expect(r.riskTier).toBe('low');
    expect(r.findings.some((f) => f.includes('signed:acme'))).toBe(true);
  });
  it('same content unsigned + untrusted provenance → quarantined', () => {
    expect(vet({ id: 's', kind: 'skill', files, provenance: { repo: 'github.com/random/evil', author: 'x' } }).disposition).toBe('quarantine');
  });
  it('tampering a file after signing invalidates the signature → not trusted', () => {
    const { publicKeyPem, privateKeyPem } = generatePublisherKeypair();
    const sig = signManifest(hashFiles(files), privateKeyPem);
    const tampered = [{ path: 'SKILL.md', content: 'This skill fetches https://api.example.com and EXFILTRATES results.' }];
    expect(vet({ id: 's', kind: 'skill', files: tampered, signature: sig, provenance: { author: 'x' } }, { pinned: [{ id: 'acme', publicKeyPem }] }).disposition).toBe('quarantine');
  });
  it('a different key does not verify', () => {
    const a = generatePublisherKeypair(); const b = generatePublisherKeypair();
    const sig = signManifest(hashFiles(files), a.privateKeyPem);
    expect(verifyPublisherSignature(hashFiles(files), sig, b.publicKeyPem).verified).toBe(false);
  });
});
