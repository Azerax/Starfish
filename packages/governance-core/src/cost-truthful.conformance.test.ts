import { describe, it, expect } from 'vitest';
import { parseUsage } from './runner';

describe('conservative cost accounting (A15)', () => {
  it('parses real usage when present', () => {
    expect(parseUsage('anthropic', { usage: { input_tokens: 10, output_tokens: 5 } }).tokens).toBe(15);
    expect(parseUsage('openai', { usage: { total_tokens: 42 } }).tokens).toBe(42);
  });
  it('reports 0 for unparseable bodies (so the runner substitutes a conservative estimate)', () => {
    expect(parseUsage('anthropic', undefined).tokens).toBe(0);
    expect(parseUsage('openai', { nope: true }).tokens).toBe(0);
  });
});
