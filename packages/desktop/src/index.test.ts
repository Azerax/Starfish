import { describe, it, expect } from 'vitest';
import { VERSION } from './index';
describe('desktop', () => {
  it('has a version', () => { expect(VERSION).toBe('0.0.0'); });
});
