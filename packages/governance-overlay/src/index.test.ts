import { describe, it, expect } from 'vitest';
import { VERSION } from './index';
describe('governance-overlay', () => { it('has a semver version', () => { expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/); }); });
