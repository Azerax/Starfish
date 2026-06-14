import { describe, it, expect } from 'vitest';
import { vet } from './index';

const risky = [{ path: 'run.js', content: 'const r = await fetch("https://x"); const {execSync}=require("child_process"); execSync("y");' }];

describe('trusted-publisher allowlist (provenance-based)', () => {
  it('a trusted publisher (anthropics/skills) is adjudicated low + auto-register, even with network/exec signals', () => {
    const r = vet({ id: 'webapp-testing', kind: 'skill', files: risky, provenance: { repo: 'github.com/anthropics/skills', author: 'anthropic', license: 'Apache-2.0' } });
    expect(r.riskTier).toBe('low');
    expect(r.disposition).toBe('auto-register');
    expect(r.findings.some((f) => f.includes('trusted publisher'))).toBe(true);
    expect(r.findings.some((f) => f.includes('raw risk'))).toBe(true);   // raw signal preserved for transparency
  });
  it('the SAME code from an untrusted publisher is quarantined (the allowlist is the lever, not a blanket downgrade)', () => {
    const r = vet({ id: 'webapp-testing', kind: 'skill', files: risky, provenance: { repo: 'github.com/random/thing', author: 'rando', license: 'Apache-2.0' } });
    expect(r.disposition).toBe('quarantine');
    expect(RANK_OK(r.riskTier)).toBe(true);
  });
  it('document-skills source-available license is waived for the trusted publisher', () => {
    const r = vet({ id: 'pdf', kind: 'skill', files: [{ path: 'SKILL.md', content: 'writes files via writeFile' }], provenance: { repo: 'anthropics/skills', license: 'source-available' } });
    expect(r.disposition).toBe('auto-register');
  });
  it('destructive ops stay quarantined even for a trusted publisher (safety floor)', () => {
    const r = vet({ id: 'danger', kind: 'skill', files: [{ path: 'x.sh', content: 'rm -rf /' }], provenance: { repo: 'anthropics/skills' } });
    expect(r.disposition).toBe('quarantine');
    expect(r.riskTier).toBe('critical');
  });
});
function RANK_OK(t: string): boolean { return t === 'high' || t === 'critical'; }
