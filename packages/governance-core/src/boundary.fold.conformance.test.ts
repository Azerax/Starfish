import { describe, it, expect } from 'vitest';
import { caseFold, sameOrUnder } from './boundary';

describe('boundary case/unicode fold (audit A1)', () => {
  it('case-insensitive mode matches case-varied paths and denied subtrees', () => {
    expect(sameOrUnder('/proj/WS/x', '/proj/ws', true)).toBe(true);
    expect(sameOrUnder('/proj/.STARFISH/y', '/proj/.starfish', true)).toBe(true);
    expect(sameOrUnder('/proj/WS/x', '/proj/ws', false)).toBe(false);
  });
  it('does not over-match a sibling prefix', () => {
    expect(sameOrUnder('/proj/wsX/x', '/proj/ws', true)).toBe(false);
  });
  it('NFC-normalizes composed vs decomposed unicode', () => {
    expect(caseFold('/p/é', false)).toBe(caseFold('/p/é', false));
  });
});
