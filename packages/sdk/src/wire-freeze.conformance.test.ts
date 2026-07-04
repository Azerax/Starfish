import { describe, it, expect } from 'vitest';
import { WIRE_VERSION } from './serve';

// The sidecar wire protocol is FROZEN. Bumping this integer is a breaking change: it forces every
// httpBridge client to re-handshake (serve.ts returns 426 on mismatch). Changing this test is the
// deliberate signal that the wire contract changed — it must move in lockstep with a major/minor bump.
describe('wire protocol freeze (v0.17.0 semver gate)', () => {
  it('WIRE_VERSION is pinned at 1', () => {
    expect(WIRE_VERSION).toBe(1);
  });
});
