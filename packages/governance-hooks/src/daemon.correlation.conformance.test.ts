import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { loadGovernor } from '@starfish/governance-core';
import { PdpDaemon } from './daemon';

function seedGov() {
  const root = mkdtempSync(join(tmpdir(), 'sf-corr-'));
  const gov = join(root, 'governance'); mkdirSync(gov, { recursive: true }); mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([{ id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' }]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'worker', domain: 'execution', allowedTools: ['fs.read'], riskTier: 'high' }]));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify([{ id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' }]));
  return { root, gov, audit: join(root, 'audit.jsonl') };
}

// one hook call = one connection: hello -> reply -> payload -> reply (mirrors the CLI shim)
function call(sock: string, hello: object, payload: object): Promise<object> {
  return new Promise((res, rej) => {
    const c = createConnection(sock); let buf = '', stage = 'hello';
    const to = setTimeout(() => { c.destroy(); rej(new Error('timeout')); }, 3000);
    c.on('connect', () => c.write(JSON.stringify(hello) + '\n'));
    c.on('data', (d) => { buf += d.toString(); let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (stage === 'hello') { stage = 'p'; c.write(JSON.stringify(payload) + '\n'); }
        else { clearTimeout(to); c.destroy(); res(m); } } });
    c.on('error', (e) => { clearTimeout(to); rej(e); });
  });
}

describe('PdpDaemon — session-keyed PreToolUse->PostToolUse correlation (across per-call connections)', () => {
  let h: ReturnType<typeof seedGov>; let daemon: PdpDaemon; const sock = join(tmpdir(), `sf-corr-${process.pid}.sock`);
  beforeAll(async () => {
    h = seedGov();
    const g = loadGovernor(h.gov, h.audit, { stateDir: join(h.root, 'state') });
    daemon = new PdpDaemon(g, () => ({ visibility: [h.root], write: [h.root] }));
    await daemon.listen(sock);
  });
  afterAll(() => daemon.close());

  it('a PostToolUse that matches a prior allowed PreToolUse in the SAME session is NOT an orphan', async () => {
    const hello = { type: 'hello', agentId: 'worker', session_id: 'S1' };
    const pre = await call(sock, hello, { hook_event_name: 'PreToolUse', session_id: 'S1', tool_name: 'fs.read', tool_input: { path: join(h.root, 'a') } }) as { permissionDecision: string };
    expect(pre.permissionDecision).toBe('allow');
    const post = await call(sock, hello, { hook_event_name: 'PostToolUse', session_id: 'S1', tool_name: 'fs.read' }) as { permissionDecision?: string };
    expect(post.permissionDecision).toBeUndefined();   // {} = correlated, not flagged
  });

  it('a PostToolUse with NO matching PreToolUse is flagged as a no-silent-execution orphan', async () => {
    const post = await call(sock, { type: 'hello', agentId: 'worker', session_id: 'S2' }, { hook_event_name: 'PostToolUse', session_id: 'S2', tool_name: 'fs.read' }) as { permissionDecision?: string };
    expect(post.permissionDecision).toBe('deny');
    expect(readFileSync(h.audit, 'utf8')).toMatch(/orphan-post/);
  });
});
