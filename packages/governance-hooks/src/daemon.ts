// PDP daemon — the live enforcement seam. A local socket server that a per-agent PreToolUse hook
// connects to: it sends a {type:'hello', agentId} handshake (binding the connection to that agent),
// then streams hook payloads; the daemon runs each through a per-connection HookSession (the PDP)
// and returns the permission decision. Newline-delimited JSON. (Unix socket path on macOS/Linux;
// a \\.\pipe\... name on Windows.)
//
// Session tracking (optional `live` options): every hook event is also recorded in a SessionRegistry,
// and a PreToolUse that comes back `ask` is mirrored into a DecisionBroker on the 'claude-code'
// channel, so one queue shows every open ask. This is observation only. It runs AFTER the decision
// is written back, it never alters a decision, and any failure in it is swallowed: the enforcement
// path is the same with or without it.
import { createServer, type Server } from 'node:net';
import { existsSync, rmSync, statSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { redactSecrets } from '@starfish/governance-core';
import type { Governor, BoundarySet, DecisionBroker, SessionRegistry, SessionEventKind, SessionObservation } from '@starfish/governance-core';
import { HookSession, ccToGoverned, type HookPayload, type HookResponse } from './handler';

export interface DaemonLiveOptions {
  sessions?: SessionRegistry;   // record what each session is doing
  broker?: DecisionBroker;      // mirror asks here (channel 'claude-code', observe-only)
  host?: string;                // machine label shown on sessions (default: os.hostname())
  client?: string;              // who runs the sessions (default 'claude-code')
}

/** Claude Code hook event name -> session event. Unknown events only refresh activity. */
export function sessionEventKind(name: string | undefined): SessionEventKind {
  switch (name) {
    case 'SessionStart': return 'start';
    case 'UserPromptSubmit': return 'prompt';
    case 'PreToolUse': return 'tool-pre';
    case 'PostToolUse': case 'PostToolUseFailure': return 'tool-post';
    case 'Stop': return 'stop';
    case 'SessionEnd': return 'end';
    default: return 'notice';   // Notification, SubagentStop, PreCompact, ConfigChange, ...
  }
}

/** The branch checked out at `start` (or the nearest parent holding .git). Handles linked worktrees
 *  (a .git FILE pointing at the real git dir) and a detached HEAD. Best effort; never throws. */
export function gitBranch(start: string | undefined): string | undefined {
  if (!start) return undefined;
  let dir = resolve(start);
  for (let i = 0; i < 40; i++) {
    const dotgit = join(dir, '.git');
    if (existsSync(dotgit)) {
      try {
        let gitDir = dotgit;
        if (statSync(dotgit).isFile()) {
          const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, 'utf8'));
          if (!m) return undefined;
          gitDir = resolve(dir, m[1].trim());
        }
        const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : `${head.slice(0, 7)} (detached)`;
      } catch { return undefined; }
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
}

/** What a call touches, for display: path, command or URL, secret-redacted and clipped. */
export function describeTarget(toolName: string | undefined, input: Record<string, unknown> | undefined): string | undefined {
  const g = ccToGoverned(toolName ?? '', input ?? {});
  const raw = g.input.path ?? g.input.command ?? g.input.url;
  if (typeof raw !== 'string' || !raw) return undefined;
  return redactSecrets(raw).redacted.slice(0, 300);
}

function modelName(m: unknown): string | undefined {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const o = m as { id?: unknown; display_name?: unknown };
    if (typeof o.display_name === 'string') return o.display_name;
    if (typeof o.id === 'string') return o.id;
  }
  return undefined;
}

export class PdpDaemon {
  private server: Server | null = null;
  private sessions = new Map<string, HookSession>();   // keyed by CC session id (+agent) so PreToolUse->PostToolUse correlate across the per-call connections
  private host: string;
  private askSeq = 0;
  constructor(private governor: Governor, private boundaryFor: (agentId: string) => BoundarySet, private boundaryForCapability?: (capabilityId: string) => BoundarySet, private overlay?: { writeProfile?: 'ask' | 'auto'; projectRoot?: string; backupDir?: string; backups?: number }, private live?: DaemonLiveOptions) {
    this.host = live?.host ?? hostname();
  }

  listen(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try { if (existsSync(path)) rmSync(path); } catch { /* noop */ }
      this.server = createServer((conn) => {
        let session: HookSession | null = null;
        let bound: { agentId: string; ccSession: string } | null = null;
        let buf = '';
        conn.on('data', (chunk) => {
          buf += chunk.toString();
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let msg: { type?: string; agentId?: string; capabilityId?: string } & HookPayload;
            try { msg = JSON.parse(line); } catch { conn.write(JSON.stringify({ permissionDecision: 'deny', reason: 'bad json' }) + '\n'); continue; }
            if (msg.type === 'hello') {
              const agentId = String(msg.agentId ?? '');
              const capabilityId = msg.capabilityId ? String(msg.capabilityId) : undefined;   // bound here, never trusted from later payloads
              const ccSession = String((msg as { session_id?: string }).session_id ?? '');
              const sid = ccSession + '|' + agentId + '|' + (capabilityId ?? '');
              try {
                let sh = this.sessions.get(sid);
                if (!sh) {
                  const boundary = capabilityId && this.boundaryForCapability ? this.boundaryForCapability(capabilityId) : this.boundaryFor(agentId);
                  sh = new HookSession(this.governor, { expectedAgentId: agentId, boundary, capabilityId, writeProfile: this.overlay?.writeProfile, projectRoot: this.overlay?.projectRoot, backupDir: this.overlay?.backupDir, backups: this.overlay?.backups, sessionId: ccSession || undefined });
                  if (this.sessions.size > 1000) { const oldest = this.sessions.keys().next().value; if (oldest) this.sessions.delete(oldest); }   // bound memory (evict oldest)
                  this.sessions.set(sid, sh);
                }
                session = sh;
                bound = { agentId, ccSession };
                conn.write(JSON.stringify({ ok: true }) + '\n');
              } catch { conn.write(JSON.stringify({ ok: false, reason: 'boundary-derivation-failed' }) + '\n'); }   // fail closed
              continue;
            }
            if (!session || !bound) { conn.write(JSON.stringify({ permissionDecision: 'deny', reason: 'no hello (unidentified connection)' }) + '\n'); continue; }
            const resp: HookResponse = session.handle(msg as HookPayload);
            conn.write(JSON.stringify(resp) + '\n');
            this.observe(bound.agentId, bound.ccSession, msg as HookPayload, resp);
          }
        });
        conn.on('error', () => { /* client hung up */ });
      });
      this.server.on('error', reject);
      this.server.listen(path, () => resolve());
    });
  }

  /** Record one hook event in the session registry and mirror an ask into the broker. Never throws
   *  and never touches the decision, which has already been sent. */
  private observe(agentId: string, ccSession: string, p: HookPayload, resp: HookResponse): void {
    const reg = this.live?.sessions;
    if (!reg) return;
    const broker = this.live?.broker;
    try {
      const kind = sessionEventKind(p.hook_event_name);
      const sessionId = ccSession || `anon-${agentId}`;
      const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : undefined;
      const o: SessionObservation = {
        sessionId, agentId, kind,
        client: this.live?.client ?? 'claude-code',
        host: this.host,
        projectRoot: this.overlay?.projectRoot,
        cwd,
        branch: gitBranch(cwd ?? this.overlay?.projectRoot),
        model: modelName(p.model),
        permissionMode: typeof p.permission_mode === 'string' ? p.permission_mode : undefined,
        tool: p.tool_name,
        toolUseId: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
      };
      if (kind === 'tool-pre') {
        o.verdict = resp.permissionDecision ?? 'deny';
        o.target = describeTarget(p.tool_name, p.tool_input);
        o.riskTier = resp.riskTier;
        o.reason = resp.reason;
        if (o.verdict === 'ask' && broker) {
          const rec = broker.file({
            actor: agentId, kind: 'tool', tool: p.tool_name ?? 'unknown', target: o.target, riskTier: resp.riskTier,
            reason: resp.reason ?? '', refId: `${sessionId}:${o.toolUseId ?? `ask-${Date.now().toString(36)}-${this.askSeq++}`}`,
            channel: 'claude-code', sessionId,
          });
          o.decisionId = rec.id;
        }
      }
      const { settled } = reg.observe(o);
      if (settled?.ask.decisionId && broker) {
        const r = broker.settle(settled.ask.decisionId, settled.outcome);
        if (!r.ok) {
          // Filed by an earlier daemon (the registry snapshot outlives the in-memory broker). Record the
          // outcome anyway so the earlier `decision:filed` line has its ending.
          this.governor.audit.append({ actor: 'system', domain: 'governance', action: 'decision:settled', target: settled.ask.target, decision: settled.outcome === 'ran' ? 'allow' : 'deny', riskTier: settled.ask.riskTier, reason: `${settled.outcome} — filed by an earlier daemon`, sessionId, detail: { decisionId: settled.ask.decisionId, channel: 'claude-code', outcome: settled.outcome } });
        }
      }
    } catch { /* observation must never affect enforcement */ }
  }

  close(): void { try { this.server?.close(); } catch { /* noop */ } this.server = null; }
}
