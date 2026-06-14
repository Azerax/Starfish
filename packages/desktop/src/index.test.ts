import { describe, it, expect } from 'vitest';
import { VERSION } from './index';
describe('desktop host', () => { it('has a version', () => { expect(VERSION).toBe('0.9.0'); }); });
