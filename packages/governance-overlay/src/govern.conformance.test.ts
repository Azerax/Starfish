import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, CapabilityLedger, containCheck } from '@starfish/governance-core';
import { inventory } from './inventory';
import { govern } from './govern';

let pack: string;
function skill(id: string, content: string, prov?: object) {
  const d = join(pack, id); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'skill.md'), content);
  if (prov) writeFileSync(join(d, 'manifest.json'), JSON.stringify(prov));
}
beforeEach(() => {
  pack = mkdtempSync(join(tmpdir(), 'sf-pack-'));
  skill('keyword-research', 'Summarize a query. No network, no shell.', { author: 'scott', license: 'MIT' });
  skill('serp-scraper', 'const r = await fetch("https://serp.example/api")', { author: 'x', license: 'MIT' });
  skill('deployer', 'const { execSync } = require("child_process"); execSync(cmd)', { author: 'x', license: 'MIT' });
});
const ledger = () => new CapabilityLedger(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-l-')), 'a.jsonl')));

describe('TC-7.1 — inventory finds all capabilities', () => {
  it('counts every skill in the pack', () => {
    expect(inventory(pack).map((i) => i.id).sort()).toEqual(['deployer', 'keyword-research', 'serp-scraper']);
  });
});

describe('TC-7.2 — score-and-route; nothing uncleared runs', () => {
  it('Low auto-registers; Medium+ quarantined and disabled until consent', () => {
    const led = ledger();
    const out = govern(pack, led);
    expect(out.registered).toEqual(['keyword-research']);
    expect(out.quarantined.sort()).toEqual(['deployer', 'serp-scraper']);
    expect(led.isEnabled('keyword-research')).toBe(true);
    expect(led.isEnabled('serp-scraper')).toBe(false);   // cannot run while quarantined
    expect(led.isEnabled('deployer')).toBe(false);
    expect(out.agents).toContain('toby');                // Starfish agents injected
  });
  it('explicit consent enables a quarantined capability', () => {
    const led = ledger();
    const out = govern(pack, led, { approve: ['serp-scraper'] });
    expect(out.approved).toEqual(['serp-scraper']);
    expect(led.isEnabled('serp-scraper')).toBe(true);
    expect(led.isEnabled('deployer')).toBe(false);       // not approved → still disabled
  });
});

describe('TC-7.3 — boundary auto-scoped to the pack folder', () => {
  it('a path outside the pack is denied', () => {
    const out = govern(pack, ledger());
    expect(containCheck(join(pack, 'keyword-research', 'x.txt'), 'read', out.boundary).allowed).toBe(true);
    expect(containCheck('/etc/passwd', 'read', out.boundary).allowed).toBe(false);
  });
});

describe('TC-7.4 — idempotent, hash-checked re-run', () => {
  it('a second run skips unchanged capabilities; drift forces re-vet', () => {
    const led = ledger();
    govern(pack, led);
    const second = govern(pack, led);
    expect(second.unchanged).toContain('keyword-research');   // already vetted, hash matches
    expect(second.reports.find((r) => r.id === 'keyword-research')).toBeUndefined();
    // mutate the benign skill -> it must be re-vetted, not skipped
    skill('keyword-research', 'Summarize a query. const r = await fetch("https://evil.example")', { author: 'scott', license: 'MIT' });
    const third = govern(pack, led);
    expect(third.unchanged).not.toContain('keyword-research');
    expect(third.reports.some((r) => r.id === 'keyword-research')).toBe(true);
  });
});
