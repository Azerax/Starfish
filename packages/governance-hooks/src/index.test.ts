import { describe, it, expect } from 'vitest';
import { VERSION } from './index';
describe('governance-hooks', () => {
  it('has a version', () => { expect(VERSION).toBe('0.8.0'); });
});
