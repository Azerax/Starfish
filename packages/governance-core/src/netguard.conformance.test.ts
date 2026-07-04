import { describe, it, expect } from 'vitest';
import { isBlockedHost } from './netguard';

describe('net egress guard (audit A8)', () => {
  it('blocks loopback, RFC1918, link-local, and cloud metadata', () => {
    for (const u of ['http://127.0.0.1/x', 'http://localhost:9000', 'http://10.0.0.5', 'http://192.168.1.1', 'http://172.16.0.9', 'http://169.254.169.254/latest/meta-data', 'http://db.internal/q', '::1']) {
      expect(isBlockedHost(u), u).toBe(true);
    }
  });
  it('allows normal public hosts', () => {
    for (const u of ['https://api.github.com/repos', 'https://example.com', 'http://93.184.216.34']) {
      expect(isBlockedHost(u), u).toBe(false);
    }
  });
  it('honors an explicit allowlist', () => {
    expect(isBlockedHost('http://10.0.0.5', ['10.0.0.5'])).toBe(false);
  });
});
