import { describe, it, expect } from 'vitest';
import { sameOrUnder, isSecretPath, classifyPath, isBlockedHost } from './index';

// Normalize-before-match hardening: case, path separator, Windows filename tricks, and host encodings
// must not let an attacker evade a containment / secret / egress check. (companion to boundary.fold)

describe('boundary containment — separator & case robustness', () => {
  it('forward-slash child is contained by a forward-slash root (case-insensitive)', () => {
    expect(sameOrUnder('/proj/WS/x', '/proj/ws', true)).toBe(true);
    expect(sameOrUnder('/proj/.STARFISH/y', '/proj/.starfish', true)).toBe(true);
  });
  it('does not over-match a sibling prefix', () => {
    expect(sameOrUnder('/proj/ws-evil/x', '/proj/ws', true)).toBe(false);
  });
  // Windows-only: '\' and '/' are the same separator, so a mixed-separator path can't escape.
  it.skipIf(process.platform !== 'win32')('mixed \\ and / separators are equivalent on Windows', () => {
    expect(sameOrUnder('C:\\Root\\Sub\\x', 'c:/root')).toBe(true);
    expect(sameOrUnder('C:/Root/Sub/x', 'c:\\root')).toBe(true);
  });
});

describe('secret classification — Windows filename tricks resolve to the same file', () => {
  it('classifies the plain secret paths', () => {
    expect(isSecretPath('/app/.env')).toBe(true);
    expect(isSecretPath('/app/secret.pem')).toBe(true);
  });
  it('trailing dot / space still classify as the secret', () => {
    expect(isSecretPath('/app/.env.')).toBe(true);
    expect(isSecretPath('/app/.env ')).toBe(true);
  });
  it('NTFS alternate data stream suffixes still classify as the secret', () => {
    expect(isSecretPath('/app/.env::$DATA')).toBe(true);
    expect(isSecretPath('/app/secret.pem:hidden')).toBe(true);
    expect(classifyPath('/app/.env:x').why).toContain('.env');
  });
  it('backslash-separated Windows path is classified', () => {
    expect(isSecretPath('C:\\app\\.env')).toBe(true);
  });
  it('does not misclassify an ordinary file', () => {
    expect(isSecretPath('/app/notes.txt')).toBe(false);
  });
});

describe('egress host guard — normalization before blocklist match', () => {
  it('blocks loopback / metadata / private as before', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('10.0.0.5')).toBe(true);
  });
  it('blocks a trailing-dot FQDN that resolves to the same host', () => {
    expect(isBlockedHost('localhost.')).toBe(true);
    expect(isBlockedHost('foo.internal.')).toBe(true);
  });
  it('blocks IPv4-mapped IPv6 forms of loopback and metadata', () => {
    expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedHost('::ffff:169.254.169.254')).toBe(true);
  });
  it('still allows a normal external host', () => {
    expect(isBlockedHost('example.com')).toBe(false);
  });
});
