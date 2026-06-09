import { describe, it, expect } from 'vitest';
import { VERSION, RING, containCheck } from './index';

describe('governance-core (ring 1) surface', () => {
  it('exposes version + ring', () => { expect(VERSION).toBe('0.5.0'); expect(RING).toBe(1); });
  it('containCheck denies an obvious escape', () => {
    expect(containCheck('/etc/passwd', 'read', { visibility: ['/tmp/x'], write: ['/tmp/x'] }).allowed).toBe(false);
  });
});
