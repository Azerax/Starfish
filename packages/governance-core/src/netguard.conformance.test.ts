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

  // F19 — the guard was IPv4-only; IPv6 internal ranges (incl. the hex form of mapped loopback that
  // new URL() produces) slipped through to loopback / link-local / unique-local / metadata.
  it('F19: blocks IPv6 internal ranges in every form', () => {
    for (const u of [
      'http://[::1]/',                       // loopback bracketed
      'http://[::ffff:127.0.0.1]/',          // mapped loopback — URL() normalizes to hex ::ffff:7f00:1
      '::ffff:7f00:1',                       // mapped loopback, raw hex form
      'http://[fe80::1]/',                   // link-local
      'http://[fc00::1]/',                   // unique-local fc00::/7
      'http://[fd00:ec2::254]/latest/meta-data/', // metadata over IPv6 (unique-local)
      'http://[64:ff9b::7f00:1]/',           // NAT64
      'http://[::]/',                        // unspecified
    ]) {
      expect(isBlockedHost(u), u).toBe(true);
    }
  });

  // F12 — an unresolvable / empty host must fail CLOSED (blocked), not open.
  it('F12: empty or unparseable host is blocked, not allowed', () => {
    expect(isBlockedHost('')).toBe(true);
    expect(isBlockedHost('http://')).toBe(true);
  });

  it('still allows public IPv6', () => {
    expect(isBlockedHost('http://[2606:4700:4700::1111]/')).toBe(false);  // Cloudflare DNS, public
  });
});
