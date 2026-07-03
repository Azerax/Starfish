import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRootSchema, readRootSchema, ROOT_SCHEMA_VERSION } from './schema';

const root = () => mkdtempSync(join(tmpdir(), 'sf-schema-'));

describe('governed-root schema stamp (risk 80)', () => {
  it('stamps the current version when absent', () => {
    const r = root();
    expect(readRootSchema(r)).toBeUndefined();
    ensureRootSchema(r);
    expect(readRootSchema(r)).toBe(ROOT_SCHEMA_VERSION);
  });
  it('fails closed when the root schema is newer than supported', () => {
    const r = root();
    writeFileSync(join(r, 'schema.json'), JSON.stringify({ version: ROOT_SCHEMA_VERSION + 999 }));
    expect(() => ensureRootSchema(r)).toThrow(/fail-closed/);
  });
  it('migrates (re-stamps) an older root', () => {
    const r = root();
    writeFileSync(join(r, 'schema.json'), JSON.stringify({ version: 0 }));
    ensureRootSchema(r);
    expect(readRootSchema(r)).toBe(ROOT_SCHEMA_VERSION);
  });
});
