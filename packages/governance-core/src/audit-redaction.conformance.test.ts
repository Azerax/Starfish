import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';

describe('audit redaction (risk 37)', () => {
  it('redacts secret material in reason/target and keeps the chain valid', () => {
    const a = new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-aud-')), 'audit.jsonl'));
    const ev = a.append({ actor: 'x', domain: 'system', action: 'test', reason: 'leaked sk-abcdefabcdef123456 here', target: 'API_KEY=hunter2secret' });
    expect(ev.reason).not.toContain('sk-abcdefabcdef123456');
    expect(ev.reason).toContain('[redacted');
    expect(ev.target).toContain('[redacted');
    expect(a.verify()).toBe(true);
  });
});
