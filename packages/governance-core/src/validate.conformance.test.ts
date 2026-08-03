import { describe, it, expect } from 'vitest';
import { assertEnum, clampEnum, InvalidEnumValueError } from './validate';

const VERDICTS = ['approve', 'deny'] as const;
const RISK_TIERS = ['low', 'medium', 'high', 'critical'] as const;

describe('assertEnum — no safe default, must reject anything unrecognized', () => {
  it('returns the value when it exactly matches', () => {
    expect(assertEnum('approve', VERDICTS, 'verdict')).toBe('approve');
    expect(assertEnum('deny', VERDICTS, 'verdict')).toBe('deny');
  });

  it('throws InvalidEnumValueError on a near-miss (the exact class of bug this exists to catch)', () => {
    expect(() => assertEnum('denied', VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
    expect(() => assertEnum('Approve', VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
  });

  it('throws on undefined, null, empty string, and non-string types', () => {
    expect(() => assertEnum(undefined, VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
    expect(() => assertEnum(null, VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
    expect(() => assertEnum('', VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
    expect(() => assertEnum(42, VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
    expect(() => assertEnum(['approve'], VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
    expect(() => assertEnum({ toString: () => 'approve' }, VERDICTS, 'verdict')).toThrow(InvalidEnumValueError);
  });

  it('error message names the field, the allowed set, and the actual bad value', () => {
    try {
      assertEnum('denied', VERDICTS, 'verdict');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('verdict');
      expect((e as Error).message).toContain('"approve"');
      expect((e as Error).message).toContain('"deny"');
      expect((e as Error).message).toContain('"denied"');
    }
  });
});

describe('clampEnum — always needs a value, degrades to the safe fallback', () => {
  it('returns the value when it exactly matches', () => {
    expect(clampEnum('low', RISK_TIERS, 'critical')).toBe('low');
    expect(clampEnum('critical', RISK_TIERS, 'critical')).toBe('critical');
  });

  it('degrades an unrecognized value to the caller-supplied safe fallback instead of throwing', () => {
    expect(clampEnum('bogus', RISK_TIERS, 'critical')).toBe('critical');
    expect(clampEnum(undefined, RISK_TIERS, 'critical')).toBe('critical');
    expect(clampEnum('Low', RISK_TIERS, 'critical')).toBe('critical');   // case-sensitive: a near-miss is NOT a match
  });

  it('never throws, regardless of input shape', () => {
    expect(() => clampEnum(null, RISK_TIERS, 'critical')).not.toThrow();
    expect(() => clampEnum(42, RISK_TIERS, 'critical')).not.toThrow();
    expect(() => clampEnum({}, RISK_TIERS, 'critical')).not.toThrow();
  });
});
