// PDP daemon — the live enforcement seam. A local socket server that a per-agent PreToolUse hook
// connects to: it sends a {type:'hello', agentId} handshake (binding the connection to that agent),
// then streams hook payloads; the daemon runs each through a per-connection HookSession (the PDP)
// and returns the permission decision. Newline-delimited JSON. (Unix socket path on macOS/Linux;
// a \\.\pipe\... name on Windows.)
import { createServer, type Server } from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import type { Governor, BoundarySet } from '@starfish/governance-core';
import { HookSession, type HookPayload, type HookResponse } from './handler';

export class PdpDaemon {
  private server: Server | null = null;
  constructor(private governor: Governor, private boundaryFor: (agentId: string) => BoundarySet) {}

  listen(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try { if (existsSync(path)) rmSync(path); } catch { /* noop */ }
      this.server = createServer((conn) => {
        let session: HookSession | null = null;
        let buf = '';
        conn.on('data', (chunk) => {
          buf += chunk.toString();
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let msg: { type?: string; agentId?: string } & HookPayload;
            try { msg = JSON.parse(line); } catch { conn.write(JSON.stringify({ permissionDecision: 'deny', reason: 'bad json' }) + '\n'); continue; }
            if (msg.type === 'hello') {
              const agentId = String(msg.agentId ?? '');
              try { session = new HookSession(this.governor, { expectedAgentId: agentId, boundary: this.boundaryFor(agentId) }); conn.write(JSON.stringify({ ok: true }) + '\n'); }
              catch { conn.write(JSON.stringify({ ok: false, reason: 'boundary-derivation-failed' }) + '\n'); }   // fail closed
              continue;
            }
            if (!session) { conn.write(JSON.stringify({ permissionDecision: 'deny', reason: 'no hello (unidentified connection)' }) + '\n'); continue; }
            const resp: HookResponse = session.handle(msg as HookPayload);
            conn.write(JSON.stringify(resp) + '\n');
          }
        });
        conn.on('error', () => { /* client hung up */ });
      });
      this.server.on('error', reject);
      this.server.listen(path, () => resolve());
    });
  }
  close(): void { try { this.server?.close(); } catch { /* noop */ } this.server = null; }
}
