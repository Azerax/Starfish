import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { AuditLog, CapabilityLedger } from '@starfish/governance-core';

interface SeedEntry { id: string; kind: string; riskTier: string; status: string; contentHash: string }
const seed: SeedEntry[] = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'defaults', 'registry-seed.json'), 'utf8'));

describe('default registry seed — vetted via trusted publisher (anthropics/skills)', () => {
  it('has 17 skills, all enabled by the trusted-publisher allowlist', () => {
    expect(seed.length).toBe(17);
    expect(seed.every((e) => e.status === 'enabled')).toBe(true);
  });
  it('empty contentHash forces a full file-level re-vet on real install (hash-on-vet)', () => {
    expect(seed.every((e) => e.contentHash === '')).toBe(true);
  });
  it('restores into a CapabilityLedger as the live registry', () => {
    const led = new CapabilityLedger(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-seed-')), 'a.jsonl')));
    led.restore(seed as never);
    expect(led.snapshot().length).toBe(17);
    expect(led.isEnabled('webapp-testing')).toBe(true);   // trusted publisher → enabled (runtime PDP still gates it)
    expect(led.isEnabled('xlsx')).toBe(true);
  });
});
