import { describe, it, expect } from 'vitest';
import { makeTaxonomy, DEFAULT_TAXONOMY } from './taxonomy';

describe('tool taxonomy', () => {
  it('maps known host tools to governed tools and normalizes the path key', () => {
    const m = DEFAULT_TAXONOMY.map('WriteFile', { file_path: '/x/y.txt', content: 'z' });
    expect(m.tool).toBe('fs.write');
    expect(m.input.path).toBe('/x/y.txt');
  });
  it('passes unknown host tools through unchanged (so the PDP default-denies)', () => {
    const m = DEFAULT_TAXONOMY.map('Frobnicate', { a: 1 });
    expect(m.tool).toBe('Frobnicate');
  });
  it('supports custom rules', () => {
    const t = makeTaxonomy({ Save: { governed: 'fs.write', pathKeys: ['dest'] } });
    const m = t.map('Save', { dest: '/a' });
    expect(m.tool).toBe('fs.write'); expect(m.input.path).toBe('/a');
  });
});
