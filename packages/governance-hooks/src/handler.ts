// @starfish/governance-hooks — the PreToolUse/PostToolUse/Stop seam (ring 2).
// Forwards Claude Code hook payloads to the PDP and returns a permission decision.
import type { Governor, ToolCall, BoundarySet } from '@starfish/governance-core';
import { isBlockedHost, isCatastrophicShell } from '@starfish/governance-core';
import { existsSync, copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

export interface HookPayload {
  hook_event_name: string;
  agent_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  capability_id?: string;
  session_id?: string;
}
export interface HookResponse { permissionDecision?: 'allow' | 'deny' | 'ask'; reason?: string; }
export interface HookContext { expectedAgentId: string; boundary: BoundarySet; capabilityId?: string; writeProfile?: 'ask' | 'auto'; projectRoot?: string; backupDir?: string; backups?: number; }

// ---- Claude Code tool taxonomy -> governed tool vocabulary (ring-2 seam) ----
// CC fires native tools (Read/Edit/Bash/...). The PDP reasons over governed tools (fs.read/fs.write/
// shell/net). Map name + extract the path so the boundary engine can contain it. Unknown CC tools pass
// their name through and hit default-deny (not registered) — deny-by-default for anything we don't model.
const CC_READ = new Set(['Read', 'Glob', 'Grep', 'NotebookRead']);
const CC_LIST = new Set(['LS']);
const CC_WRITE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookWrite']);
const CC_NET = new Set(['WebFetch', 'WebSearch']);
// F-11: the catastrophic-shell denylist MOVED to @starfish/governance-core (`shellguard.ts`) and is
// now enforced inside PDP.ingress, so every surface inherits it — SDK and sidecar consumers used to
// get no screening at all because this list lived only here. Re-exported for API compatibility, and
// still called below as a fast pre-filter so overlay behaviour is unchanged.
export { isCatastrophicShell } from '@starfish/governance-core';

export interface GovernedCall { tool: string; input: Record<string, unknown> }

// F-5: a Glob/Grep pattern can itself name an absolute location ('/etc/**'), so the pattern — not
// just an optional `path` — determines what actually gets read. The old mapping discarded the pattern
// and substituted '.', so the PDP adjudicated the cwd while the tool read somewhere else entirely,
// and `Glob{pattern:'/etc/**'}` was ALLOWED. Extract the literal directory prefix of a glob and
// govern that. Returns undefined for a purely relative pattern (nothing new to check).
function globRoot(pattern: unknown): string | undefined {
  if (typeof pattern !== 'string' || !pattern) return undefined;
  const firstMeta = pattern.search(/[*?[{]/);
  const literal = firstMeta === -1 ? pattern : pattern.slice(0, firstMeta);
  const dir = literal.replace(/[^/\\]*$/, '');          // drop a trailing partial segment
  if (!dir) return undefined;
  const isAbsolute = /^([/\\]|[A-Za-z]:[/\\])/.test(dir);
  const escapes = dir.split(/[/\\]/).includes('..');
  return isAbsolute || escapes ? dir : undefined;       // only govern what leaves the cwd
}

export function ccToGoverned(name: string, input: Record<string, unknown> = {}): GovernedCall {
  const inp = input ?? {};
  const path = (inp.file_path ?? inp.notebook_path ?? inp.path) as string | undefined;
  if (CC_READ.has(name)) return { tool: 'fs.read', input: { path: path ?? globRoot(inp.pattern) ?? '.' } };
  if (CC_LIST.has(name)) return { tool: 'fs.list', input: { path: path ?? '.' } };
  // F-6: `content` was dropped, so the PDP's poisoned-.env screening (screenEnv) could never see what
  // was actually being written — the content-based half of secret governance was unreachable from the
  // overlay. Carry it through; the PDP only reads it for secret-path writes.
  if (CC_WRITE.has(name)) {
    const content = inp.content ?? inp.new_string ?? inp.new_source;
    return { tool: 'fs.write', input: typeof content === 'string' ? { path: path ?? '', content } : { path: path ?? '' } };
  }
  if (name === 'Bash') return { tool: 'shell', input: { command: String(inp.command ?? '') } };
  if (CC_NET.has(name)) return { tool: 'net', input: { url: String(inp.url ?? inp.query ?? '') } };
  return { tool: name, input: inp };   // unknown -> passthrough -> default-deny
}

// Pre-image backup: before an auto-allowed in-boundary write, snapshot the current file so any overwrite
// (or later delete) is recoverable. Backups live under .starfish/backups (inside the deny subtree, so the
// agent cannot read or tamper with them). Keeps the most recent `keep` versions per file.
//
// F-4 (adversarial review): this returned a bare boolean, and `false` meant BOTH "no existing file, so
// nothing to back up" and "the backup threw". The caller rendered that single boolean as
// `backed ? 'backed up' : 'new file'`, so a FAILED backup was audited as a safe file creation — an
// operator reading the log could not tell a harmless create from an unrecoverable overwrite. It now
// returns a tri-state, and the caller refuses to auto-allow on 'failed'.
export type BackupOutcome = 'backed-up' | 'not-applicable' | 'failed';
function snapshotBackup(absPath: string, backupDir: string, projectRoot: string, keep: number): BackupOutcome {
  if (!existsSync(absPath)) return 'not-applicable';               // new file -> nothing to back up yet
  try {
    const rel = relative(projectRoot, absPath).replace(/[\\/]/g, '__') || 'file';
    const dir = join(backupDir, rel); mkdirSync(dir, { recursive: true });
    copyFileSync(absPath, join(dir, new Date().toISOString().replace(/[:.]/g, '-')));
    const files = readdirSync(dir).sort();
    while (files.length > Math.max(1, keep)) { const old = files.shift(); if (old) rmSync(join(dir, old)); }
    return 'backed-up';
  } catch { return 'failed'; }
}

export function handleHook(payload: HookPayload, gov: Governor, ctx: HookContext): HookResponse {
  // socket↔agent binding (S-6): a payload claiming another agent over this connection is rejected.
  if (payload.agent_id && payload.agent_id !== ctx.expectedAgentId) {
    return { permissionDecision: 'deny', reason: 'agent-id mismatch (impersonation blocked)' };
  }
  if (payload.capability_id && payload.capability_id !== ctx.capabilityId) {
    return { permissionDecision: 'deny', reason: 'capability-id mismatch (confused-deputy blocked)' };
  }
  if (payload.hook_event_name === 'PreToolUse') {
    const g = ccToGoverned(payload.tool_name ?? '', payload.tool_input ?? {});
    if (g.tool === 'shell' && isCatastrophicShell(String(g.input.command ?? ''))) {
      try { gov.audit.append({ actor: ctx.expectedAgentId, domain: 'governance', action: 'ingress:shell', decision: 'deny', reason: 'catastrophic shell command blocked' }); } catch { /* fail closed below */ }
      return { permissionDecision: 'deny', reason: 'catastrophic shell command blocked' };
    }
    if (g.tool === 'net' && isBlockedHost(String(g.input.url ?? ''))) {
      try { gov.audit.append({ actor: ctx.expectedAgentId, domain: 'governance', action: 'ingress:net', decision: 'deny', reason: 'blocked internal/loopback destination' }); } catch { /* fail closed */ }
      return { permissionDecision: 'deny', reason: 'blocked internal/loopback destination' };
    }
    const call: ToolCall = { agentId: ctx.expectedAgentId, tool: g.tool, input: g.input, capabilityId: ctx.capabilityId };
    const d = gov.pdp.decide('ingress', call, ctx.boundary);
    return { permissionDecision: d.allow ? 'allow' : d.ask ? 'ask' : 'deny', reason: d.reason };
  }
  return {};   // PostToolUse correlation + Stop-loop arrive in later phases
}

/** A per-agent hook session that correlates PreToolUse→PostToolUse so a tool result with
 *  no preceding allowed PreToolUse is flagged as a no-silent-execution violation (T-10/TC-1.7). */
export class HookSession {
  private pending: string[] = [];
  constructor(private gov: Governor, private ctx: HookContext) {}

  handle(payload: HookPayload): HookResponse {
    if (payload.agent_id && payload.agent_id !== this.ctx.expectedAgentId) {
      return { permissionDecision: 'deny', reason: 'agent-id mismatch (impersonation blocked)' };
    }
    if (payload.capability_id && payload.capability_id !== this.ctx.capabilityId) {
      return { permissionDecision: 'deny', reason: 'capability-id mismatch (confused-deputy blocked)' };
    }
    if (payload.hook_event_name === 'PreToolUse') {
      const g = ccToGoverned(payload.tool_name ?? '', payload.tool_input ?? {});
      if (g.tool === 'shell' && isCatastrophicShell(String(g.input.command ?? ''))) {
        try { this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'governance', action: 'ingress:shell', decision: 'deny', reason: 'catastrophic shell command blocked' }); } catch { /* noop */ }
        return { permissionDecision: 'deny', reason: 'catastrophic shell command blocked' };
      }
      if (g.tool === 'net' && isBlockedHost(String(g.input.url ?? ''))) {
        try { this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'governance', action: 'ingress:net', decision: 'deny', reason: 'blocked internal/loopback destination' }); } catch { /* noop */ }
        return { permissionDecision: 'deny', reason: 'blocked internal/loopback destination' };
      }
      const call: ToolCall = { agentId: this.ctx.expectedAgentId, tool: g.tool, input: g.input, capabilityId: this.ctx.capabilityId };
      const d = this.gov.pdp.decide('ingress', call, this.ctx.boundary);   // audit-before-act happens inside decide()
      // Friction profile: the user owns risk for THEIR OWN files. An in-boundary file write that the PDP
      // would merely ASK about is auto-allowed under writes=auto, with a pre-image backup. The PDP has
      // already DENIED anything that risks the system (out-of-boundary, secrets, .starfish), so this only
      // ever relaxes safe, in-project, recoverable writes - never the system-risk floor.
      // Friction profile, hardened after the adversarial review. Two rules now bound it:
      //   F-3 — only a ROUTINE risk escalation (askOrigin 'risk') may be relaxed. An operator who
      //         wrote an explicit `ask` policy ('policy'), or a hard floor ('floor'), outranks the
      //         profile. Previously both arrived as an indistinguishable {allow:false, ask:true} and
      //         writes=auto silently voided the operator's own rule.
      //   F-4 — the relaxation is justified ONLY by recoverability, so a backup that FAILED must not
      //         buy it. 'failed' falls through to the normal ask instead of auto-allowing.
      if (!d.allow && d.ask && d.askOrigin === 'risk' && g.tool === 'fs.write'
          && this.ctx.writeProfile === 'auto' && this.ctx.projectRoot && this.ctx.backupDir) {
        const outcome = snapshotBackup(resolve(String(g.input.path ?? '')), this.ctx.backupDir, this.ctx.projectRoot, this.ctx.backups ?? 3);
        if (outcome === 'failed') {
          this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'governance', action: 'ingress:fs.write', decision: 'deny', riskTier: 'high',
            reason: '[Starfish] auto-allow withheld — pre-image backup FAILED, overwrite would be unrecoverable; escalated to operator' });
          return { permissionDecision: 'ask', reason: '[Starfish] backup failed — overwrite would be unrecoverable; approve explicitly to proceed' };
        }
        const note = outcome === 'backed-up' ? 'backed up' : 'new file (nothing to back up)';
        this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'tool', action: 'ingress:fs.write', decision: 'allow', reason: `[Starfish] in-boundary write auto-allowed (writes=auto; ${note})` });
        this.pending.push('fs.write');
        return { permissionDecision: 'allow', reason: `[Starfish] in-boundary write auto-allowed (${note})` };
      }
      if (d.allow) this.pending.push(g.tool);
      return { permissionDecision: d.allow ? 'allow' : d.ask ? 'ask' : 'deny', reason: d.reason };
    }
    if (payload.hook_event_name === 'PostToolUse') {
      const tool = ccToGoverned(payload.tool_name ?? '', payload.tool_input ?? {}).tool;
      const i = this.pending.indexOf(tool);
      if (i === -1) {
        try {
          this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'failure', action: `orphan-post:${tool}`,
            decision: 'deny', reason: 'PostToolUse without a matching allowed PreToolUse (no-silent-execution violation)' });
        } catch { /* fail closed below */ }
        return { permissionDecision: 'deny', reason: 'orphan PostToolUse flagged' };
      }
      this.pending.splice(i, 1);
      return {};
    }
    return {};
  }
}
