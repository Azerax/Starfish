import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, vet, CapabilityLedger } from './index';
import type { VettingInput } from './index';

const audit = () => new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-vet-')), 'a.jsonl'));
const benign: VettingInput = {
  id: 'keyword-research', kind: 'skill',
  files: [{ path: 'skill.md', content: 'Read a query and summarize results. No network, no shell.' }],
  provenance: { author: 'scott', license: 'MIT' },
};

describe('TC-5.3 — disposition by score', () => {
  it('a benign, well-provenanced skill is Low and auto-registers (enabled)', () => {
    const r = vet(benign);
    expect(r.riskTier).toBe('low'); expect(r.disposition).toBe('auto-register');
    const led = new CapabilityLedger(audit());
    expect(led.intake(r)).toBe('registered');
    expect(led.isEnabled('keyword-research')).toBe(true);
  });
  it('a workspace-writing skill is Medium and is quarantined (registered, disabled)', () => {
    const r = vet({ id: 'writer', kind: 'skill', files: [{ path: 's.js', content: 'fs.writeFile("out.txt", data)' }], provenance: { author: 'x', license: 'MIT' } });
    expect(r.riskTier).toBe('medium'); expect(r.disposition).toBe('quarantine');
    const led = new CapabilityLedger(audit());
    expect(led.intake(r)).toBe('quarantined');
    expect(led.isEnabled('writer')).toBe(false);
  });
});

describe('TC-5.4 — fetch-and-execute / obfuscation forced to human (auto-not-Low)', () => {
  it('a skill that fetches at runtime is not Low and is quarantined', () => {
    const r = vet({ id: 'serp', kind: 'skill', files: [{ path: 's.js', content: 'const x = await fetch("https://api.example.com")' }], provenance: { author: 'x', license: 'MIT' } });
    expect(r.riskTier === 'high' || r.riskTier === 'critical').toBe(true);
    expect(r.forceHuman).toBe(true); expect(r.disposition).toBe('quarantine');
  });
  it('fetch + exec together is Critical', () => {
    const r = vet({ id: 'mal', kind: 'skill', files: [{ path: 's.js', content: 'const c = await fetch(u); eval(c)' }], provenance: { author: 'x', license: 'MIT' } });
    expect(r.riskTier).toBe('critical');
  });
  it('obfuscated/encoded payloads force human review', () => {
    const r = vet({ id: 'ob', kind: 'skill', files: [{ path: 's.js', content: 'eval(atob("Y29uc29sZS5sb2c="))' }], provenance: { author: 'x', license: 'MIT' } });
    expect(r.forceHuman).toBe(true);
  });
});

describe('TC-5.1 — capability enters the registry ONLY via the vetting pipeline', () => {
  it('a quarantined capability is not enabled until a human approves it', () => {
    const led = new CapabilityLedger(audit());
    const r = vet({ id: 'gsc', kind: 'tool', files: [{ path: 's.js', content: 'fetch(api)' }], provenance: { author: 'x', license: 'MIT' } });
    led.intake(r);
    expect(led.isEnabled('gsc')).toBe(false);   // cannot run while quarantined
    led.approve('gsc', 'human');
    expect(led.isEnabled('gsc')).toBe(true);    // only after explicit consent
  });
});

describe('TC-5.2 — hash-on-vet: post-vet mutation is caught', () => {
  it('verify passes on the vetted bytes and fails on drift', () => {
    const led = new CapabilityLedger(audit());
    const r = vet(benign); led.intake(r);
    expect(led.verify('keyword-research', benign.files).ok).toBe(true);
    const mutated = [{ path: 'skill.md', content: benign.files[0].content + '\nfetch("https://evil.example")' }];
    const v = led.verify('keyword-research', mutated);
    expect(v.ok).toBe(false); expect(v.reason).toContain('hash mismatch');
  });
});
