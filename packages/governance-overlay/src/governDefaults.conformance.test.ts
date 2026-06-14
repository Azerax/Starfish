import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, CapabilityLedger } from '@starfish/governance-core';
import { governDefaults, loadDefaultCatalog } from './index';

function skill(pack: string, id: string, content: string, prov: object) {
  const d = join(pack, id); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), content);
  writeFileSync(join(d, 'manifest.json'), JSON.stringify(prov));
}
const ledger = () => new CapabilityLedger(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-l-')), 'a.jsonl')));

describe('Default skills are governed — they enter the registry only via vetting (no exemption)', () => {
  it('catalog loads from anthropics/skills with the expected sets', () => {
    const cat = loadDefaultCatalog();
    expect(cat.length).toBeGreaterThanOrEqual(17);
    expect(cat.find((s) => s.id === 'docx')?.plugin).toBe('document-skills');
    expect(cat.some((s) => s.id === 'webapp-testing')).toBe(true);
  });

  it('vets each present default; Low enables, Medium+ quarantines, nothing auto-trusted', () => {
    const pack = mkdtempSync(join(tmpdir(), 'sf-defpack-'));
    skill(pack, 'claude-api', 'Claude API reference. Read-only docs. No network. No shell.', { author: 'anthropic', license: 'Apache-2.0' });
    skill(pack, 'webapp-testing', 'const r = await fetch("https://app.example/health"); const { execSync } = require("child_process"); execSync("run");', { author: 'anthropic', license: 'Apache-2.0' });
    skill(pack, 'not-in-catalog', 'benign helper', { author: 'x', license: 'MIT' });

    const led = ledger();
    const out = governDefaults(pack, led);

    // every registered/quarantined default has a vetting report — none bypass Toby
    expect(out.reports.map((r) => r.id).sort()).toEqual(['claude-api', 'webapp-testing']);
    // Low → enabled in the registry
    expect(out.registered).toContain('claude-api');
    expect(led.isEnabled('claude-api')).toBe(true);
    // fetch+exec → quarantined (registered-but-disabled), NOT runnable until consent
    expect(out.quarantined).toContain('webapp-testing');
    expect(led.isEnabled('webapp-testing')).toBe(false);
    // a folder NOT in the catalog is ignored by governDefaults
    expect(led.get('not-in-catalog')).toBeUndefined();
    // catalog skills with no source present are reported missing and NEVER registered (no source, no vet, no entry)
    expect(out.missing).toContain('docx');
    expect(led.get('docx')).toBeUndefined();
  });

  it('a quarantined default runs only after explicit human consent', () => {
    const pack = mkdtempSync(join(tmpdir(), 'sf-defpack2-'));
    skill(pack, 'webapp-testing', 'await fetch("http://x"); require("child_process").execSync("y");', { author: 'anthropic', license: 'Apache-2.0' });
    const led = ledger();
    expect(led.isEnabled('webapp-testing')).toBe(false);
    governDefaults(pack, led, { approve: ['webapp-testing'] });
    expect(led.isEnabled('webapp-testing')).toBe(true);   // enabled only by operator consent
  });
});
