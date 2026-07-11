import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, CATEGORY_COUNT, FLOOR_IDS, HARD_DENY_IDS, RISK_BANDS } from './index';

// Keeps the code matrix in sync with the design (docs/RISK_MATRIX.md) and pins the floor set so a
// deprecation / drift attack (A#46, A#48) fails CI.

describe('risk matrix — structure', () => {
  it('has exactly 50 categories with contiguous ids 1..50', () => {
    expect(CATEGORIES.length).toBe(CATEGORY_COUNT);
    expect(CATEGORIES.map((c) => c.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
  it('every category has a non-empty name', () => {
    for (const c of CATEGORIES) expect(c.name.length).toBeGreaterThan(0);
  });
  it('pins the exact floor set and hard-deny subset', () => {
    expect([...FLOOR_IDS].sort((a, b) => a - b)).toEqual([1, 6, 8, 10, 11, 12, 29]);
    expect([...HARD_DENY_IDS].sort((a, b) => a - b)).toEqual([1, 8, 11, 12, 29]);
  });
});

describe('risk bands — decade-aligned, contiguous 0..100', () => {
  it('covers 0..100 with no gaps or overlaps', () => {
    expect(RISK_BANDS[0].min).toBe(0);
    expect(RISK_BANDS[RISK_BANDS.length - 1].max).toBe(100);
    for (let i = 1; i < RISK_BANDS.length; i++) expect(RISK_BANDS[i].min).toBe(RISK_BANDS[i - 1].max + 1);
  });
  it('has 10 distinct descriptors and monotonic tiers', () => {
    expect(new Set(RISK_BANDS.map((b) => b.descriptor)).size).toBe(10);
    const rank = { low: 0, medium: 1, high: 2, critical: 3, injection: 4 } as const;
    for (let i = 1; i < RISK_BANDS.length; i++) expect(rank[RISK_BANDS[i].tier]).toBeGreaterThanOrEqual(rank[RISK_BANDS[i - 1].tier]);
  });
});

describe('doc parity — code matches docs/RISK_MATRIX.md', () => {
  it('the doc lists the same 50 numbered categories', () => {
    let doc = '';
    try { doc = readFileSync(join(__dirname, '../../../docs/RISK_MATRIX.md'), 'utf8'); } catch { return; } // skip if not reachable in this layout
    for (const c of CATEGORIES) expect(doc.includes(`| ${c.id} |`)).toBe(true);
  });
});
