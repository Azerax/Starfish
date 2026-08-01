// Conformance for the behavioural + structural detector inputs (TIF-1).
import { describe, it, expect } from 'vitest';
import { classifyBehaviour, classifyStructuralFeature, classifyStructuralFeatures } from './detectors';

describe('classifyBehaviour — "reading a permit should not cause credential access"', () => {
  it('flags a site source requesting the secrets category', () => {
    const f = classifyBehaviour({ sourceKind: 'site', requestedCategories: [3, 11] });
    expect(f.violates).toBe(true);
    expect(f.unexpected).toEqual([11]);
  });

  it('does not flag a request that stays within expected categories', () => {
    const f = classifyBehaviour({ sourceKind: 'site', requestedCategories: [3, 4] });
    expect(f.violates).toBe(false);
    expect(f.unexpected).toEqual([]);
  });

  it('internal (operator-originated) sources are exempt by construction', () => {
    const f = classifyBehaviour({ sourceKind: 'internal', requestedCategories: [8, 11, 29] });
    expect(f.violates).toBe(false);
  });

  it('an unrecognised source kind fails closed to the strictest (http) table entry', () => {
    const f = classifyBehaviour({ sourceKind: 'bogus' as never, requestedCategories: [8] });
    expect(f.violates).toBe(true);
  });
});

describe('classifyStructuralFeature — parser-reported location, never parsed here', () => {
  it('passes through a known feature, case/whitespace-insensitively', () => {
    expect(classifyStructuralFeature('pdf-footer')).toBe('pdf-footer');
    expect(classifyStructuralFeature('  PDF-Footer ')).toBe('pdf-footer');
  });

  it('an unrecognised value fails closed to suspicious-unclassified, never dropped', () => {
    expect(classifyStructuralFeature('made-up-tag')).toBe('suspicious-unclassified');
    expect(classifyStructuralFeature('')).toBe('suspicious-unclassified');
  });
});

describe('classifyStructuralFeatures — batch, deduped', () => {
  it('dedupes repeated + case-varied reports', () => {
    const out = classifyStructuralFeatures(['pdf-footer', 'PDF-Footer', 'hidden-text']);
    expect(out.sort()).toEqual(['hidden-text', 'pdf-footer']);
  });
});
