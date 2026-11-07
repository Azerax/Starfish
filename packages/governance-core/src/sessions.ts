// Session registry (ring 1): which agent sessions exist and what each one needs right now.
//
// The PDP judges one tool call at a time and the audit log records each judgement, but nothing
// answered "which Claude Code sessions are running, and is any of them waiting on me?". The hooks
// daemon kept a private per-session map for PreToolUse/PostToolUse correlation and exposed none of
// it. This module is the missing model: hook events go in, a list ordered by attention comes out.
//
// It is observation only. Nothing here authorizes, denies or approves anything; the PDP and the
// broker keep that job. A session's state is DERIVED from what was observed (never set directly),
// so a missed event degrades to a less specific state rather than a wrong one:
//
//   blocked  an ask is open (Starfish said "ask" and no outcome has been seen yet)
//   done     the last turn ended (Stop) and no operator has looked since
//   working  a turn is in flight and the session was active within `idleAfterMs`
//   idle     nothing in flight, or nothing heard for `idleAfterMs`
//   ended    the session ended (SessionEnd)
//
// Attention order, as in herdr: blocked > done > working > idle > ended. Blocked sessions sort
// oldest ask first (the one waiting longest); the rest sort most recently active first.
//
// Persistence is an optional snapshot file written atomically on every change. One process (the
// daemon) owns the registry; other processes (sidecar, CLI, desktop) READ the snapshot with
// `readSessionSnapshot` and never write it.
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RiskTier } from './types';

export type SessionState = 'blocked' | 'done' | 'working' | 'idle' | 'ended';
export const SESSION_ATTENTION_ORDER: readonly SessionState[] = ['blocked', 'done', 'working', 'idle', 'ended'];

/** How an open ask was closed. Starfish does not answer these asks (Claude Code's own prompt does);
 *  it only records what it saw happen next. */
export type AskOutcome =
  | 'ran'          // a PostToolUse for the asked call arrived: the person said yes
  | 'not-run'      // the turn ended, a new prompt arrived, or the session ended first: the person said no
  | 'superseded';  // another PreToolUse arrived first: the call was refused or failed without a PostToolUse

export interface SessionAsk {
  decisionId?: string;   // the broker record mirroring this ask, if one was filed
  tool: string;          // the tool as the client named it (e.g. Bash, Edit)
  target?: string;       // path / command / url, secret-redacted and clipped by the caller
  riskTier?: RiskTier;
  reason: string;
  since: string;         // ISO time the ask was raised
  toolUseId?: string;    // client correlation id (Claude Code tool_use_id), when supplied
}

export interface SessionRecord {
  sessionId: string;
  agentId: string;
  client: string;            // who runs the session: 'claude-code', ...
  projectRoot?: string;
  cwd?: string;
  branch?: string;
  host?: string;
  model?: string;
  permissionMode?: string;
  startedAt: string;
  lastActiveTs: string;
  turnOpen: boolean;         // a turn is in flight (prompt or tool seen since the last Stop)
  currentTool?: string;      // the call in flight, cleared by its PostToolUse
  pendingAsk?: SessionAsk;
  stoppedAt?: string;        // when the last turn ended
  seenAt?: string;           // when an operator last looked at this session
  endedAt?: string;
  counts: { allowed: number; asked: number; denied: number };
}

export interface SessionView extends SessionRecord { state: SessionState; }

export type SessionEventKind = 'start' | 'prompt' | 'tool-pre' | 'tool-post' | 'notice' | 'stop' | 'end';

/** One observed hook event. Only `sessionId`, `agentId` and `kind` are required. */
export interface SessionObservation {
  sessionId: string;
  agentId: string;
  kind: SessionEventKind;
  ts?: string;
  client?: string;
  projectRoot?: string;
  cwd?: string;
  branch?: string;
  host?: string;
  model?: string;
  permissionMode?: string;
  tool?: string;
  toolUseId?: string;
  verdict?: 'allow' | 'ask' | 'deny';   // the decision returned for a tool-pre
  target?: string;
  riskTier?: RiskTier;
  reason?: string;
  decisionId?: string;
}

export type SessionChange =
  | { type: 'session'; session: SessionView }
  | { type: 'ask-settled'; sessionId: string; ask: SessionAsk; outcome: AskOutcome };

export interface SessionRegistryOptions {
  persistPath?: string;
  idleAfterMs?: number;    // a turn with no events for this long reads as idle (default 10 min)
  retainMs?: number;       // drop sessions inactive for this long (default 24 h)
  maxSessions?: number;    // hard bound on tracked sessions (default 500, oldest evicted)
  now?: () => number;      // clock, for tests
}

export interface SessionSnapshot { version: 1; writtenAt: string; sessions: SessionRecord[] }

const STR_MAX = 300;
const clip = (v: unknown, max = STR_MAX): string | undefined => (typeof v === 'string' && v.length ? v.slice(0, max) : undefined);

/** Derive a session's state from its record. Pure; the clock is passed in. */
export function deriveSessionState(r: SessionRecord, now: number, idleAfterMs: number): SessionState {
  if (r.endedAt) return 'ended';
  if (r.pendingAsk) return 'blocked';
  if (r.stoppedAt && !r.turnOpen) return !r.seenAt || r.seenAt < r.stoppedAt ? 'done' : 'idle';
  if (r.turnOpen && now - Date.parse(r.lastActiveTs) < idleAfterMs) return 'working';
  return 'idle';
}

/** Order views by attention: blocked (oldest ask first), then done, working, idle, ended (most
 *  recently active first within each). */
export function sortByAttention(views: SessionView[]): SessionView[] {
  const rank = (s: SessionState): number => SESSION_ATTENTION_ORDER.indexOf(s);
  return [...views].sort((a, b) => {
    const d = rank(a.state) - rank(b.state);
    if (d !== 0) return d;
    if (a.state === 'blocked' && a.pendingAsk && b.pendingAsk) return a.pendingAsk.since.localeCompare(b.pendingAsk.since);
    return b.lastActiveTs.localeCompare(a.lastActiveTs);
  });
}

export class SessionRegistry {
  private sessions = new Map<string, SessionRecord>();
  private listeners = new Set<(c: SessionChange) => void>();
  private idleAfterMs: number;
  private retainMs: number;
  private maxSessions: number;
  private now: () => number;
  /** Set when the snapshot could not be written; cleared by the next good write. */
  persistDegraded = '';

  constructor(private opts: SessionRegistryOptions = {}) {
    this.idleAfterMs = opts.idleAfterMs ?? 10 * 60_000;
    this.retainMs = opts.retainMs ?? 24 * 60 * 60_000;
    this.maxSessions = opts.maxSessions ?? 500;
    this.now = opts.now ?? Date.now;
    this.restore();
  }

  /** Record one hook event. Returns the updated view and, when this event closed an open ask, the
   *  ask and how it was closed (the caller settles the matching broker record). */
  observe(o: SessionObservation): { session: SessionView; settled?: { ask: SessionAsk; outcome: AskOutcome } } {
    const sessionId = clip(o.sessionId, 128);
    const agentId = clip(o.agentId, 128);
    if (!sessionId || !agentId) throw new Error('SessionRegistry.observe: sessionId and agentId are required');
    const ts = o.ts ?? new Date(this.now()).toISOString();
    let r = this.sessions.get(sessionId);
    if (!r) {
      r = { sessionId, agentId, client: clip(o.client, 40) ?? 'claude-code', startedAt: ts, lastActiveTs: ts, turnOpen: false, counts: { allowed: 0, asked: 0, denied: 0 } };
      this.sessions.set(sessionId, r);
      this.bound();
    }
    // Descriptive fields: newest non-empty value wins.
    r.projectRoot = clip(o.projectRoot) ?? r.projectRoot;
    r.cwd = clip(o.cwd) ?? r.cwd;
    r.branch = clip(o.branch, 200) ?? r.branch;
    r.host = clip(o.host, 100) ?? r.host;
    r.model = clip(o.model, 80) ?? r.model;
    r.permissionMode = clip(o.permissionMode, 40) ?? r.permissionMode;
    r.lastActiveTs = ts;

    let settled: { ask: SessionAsk; outcome: AskOutcome } | undefined;
    const settle = (outcome: AskOutcome): void => {
      if (!r!.pendingAsk) return;
      settled = { ask: r!.pendingAsk, outcome };
      r!.pendingAsk = undefined;
    };

    switch (o.kind) {
      case 'start':
        r.endedAt = undefined;
        break;
      case 'prompt':
        settle('not-run');
        r.turnOpen = true; r.stoppedAt = undefined; r.endedAt = undefined; r.currentTool = undefined;
        break;
      case 'tool-pre': {
        settle('superseded');
        r.turnOpen = true; r.stoppedAt = undefined; r.endedAt = undefined;
        const tool = clip(o.tool, 120) ?? 'unknown';
        if (o.verdict === 'allow') { r.counts.allowed++; r.currentTool = tool; }
        else if (o.verdict === 'deny') { r.counts.denied++; r.currentTool = undefined; }
        else if (o.verdict === 'ask') {
          r.counts.asked++; r.currentTool = tool;
          r.pendingAsk = { decisionId: clip(o.decisionId, 120), tool, target: clip(o.target), riskTier: o.riskTier, reason: clip(o.reason, 500) ?? '', since: ts, toolUseId: clip(o.toolUseId, 120) };
        }
        break;
      }
      case 'tool-post': {
        const a = r.pendingAsk;
        if (a) {
          const sameCall = o.toolUseId && a.toolUseId ? o.toolUseId === a.toolUseId : clip(o.tool, 120) === a.tool;
          settle(sameCall ? 'ran' : 'superseded');
        }
        r.currentTool = undefined;
        break;
      }
      case 'stop':
        settle('not-run');
        r.turnOpen = false; r.currentTool = undefined; r.stoppedAt = ts;
        break;
      case 'end':
        settle('not-run');
        r.turnOpen = false; r.currentTool = undefined; r.endedAt = ts;
        break;
      case 'notice':
        break;
    }

    const view = this.view(r);
    if (settled) this.emit({ type: 'ask-settled', sessionId, ask: settled.ask, outcome: settled.outcome });
    this.emit({ type: 'session', session: view });
    this.save();
    return { session: view, settled };
  }

  /** An operator looked at this session: a 'done' session becomes 'idle'. */
  markSeen(sessionId: string): SessionView | undefined {
    const r = this.sessions.get(sessionId);
    if (!r) return undefined;
    r.seenAt = new Date(this.now()).toISOString();
    const view = this.view(r);
    this.emit({ type: 'session', session: view });
    this.save();
    return view;
  }

  get(sessionId: string): SessionView | undefined {
    const r = this.sessions.get(sessionId);
    return r ? this.view(r) : undefined;
  }

  /** Sessions in attention order. Ended sessions are left out unless asked for. */
  list(opts: { includeEnded?: boolean } = {}): SessionView[] {
    this.prune();
    const views = [...this.sessions.values()].map((r) => this.view(r)).filter((v) => opts.includeEnded || v.state !== 'ended');
    return sortByAttention(views);
  }

  /** The ask that has waited longest, if any (herdr's "jump to the oldest pending"). */
  nextBlocked(): SessionView | undefined { return this.list().find((v) => v.state === 'blocked'); }

  subscribe(fn: (c: SessionChange) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  snapshot(): SessionSnapshot {
    this.prune();
    return { version: 1, writtenAt: new Date(this.now()).toISOString(), sessions: [...this.sessions.values()].map((r) => ({ ...r, counts: { ...r.counts }, pendingAsk: r.pendingAsk ? { ...r.pendingAsk } : undefined })) };
  }

  private view(r: SessionRecord): SessionView {
    return { ...r, counts: { ...r.counts }, pendingAsk: r.pendingAsk ? { ...r.pendingAsk } : undefined, state: deriveSessionState(r, this.now(), this.idleAfterMs) };
  }

  private emit(c: SessionChange): void {
    for (const fn of this.listeners) { try { fn(c); } catch { /* a listener must not break observation */ } }
  }

  private prune(): void {
    const cutoff = this.now() - this.retainMs;
    // An open ask does not keep a session alive: a Claude Code window closed mid-prompt sends no
    // SessionEnd, and its ask would otherwise read as "blocked" forever.
    for (const [id, r] of this.sessions) if (Date.parse(r.lastActiveTs) < cutoff) this.sessions.delete(id);
  }

  private bound(): void {
    if (this.sessions.size <= this.maxSessions) return;
    const oldest = [...this.sessions.values()].sort((a, b) => a.lastActiveTs.localeCompare(b.lastActiveTs));
    for (const r of oldest) {
      if (this.sessions.size <= this.maxSessions) break;
      this.sessions.delete(r.sessionId);
    }
  }

  private save(): void {
    const p = this.opts.persistPath;
    if (!p) return;
    const data = JSON.stringify(this.snapshot(), null, 2);
    try {
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      writeFileSync(tmp, data);
      try { renameSync(tmp, p); } catch { writeFileSync(p, data); }   // a reader holding the file open (Windows) blocks rename
      this.persistDegraded = '';
    } catch (e) {
      this.persistDegraded = `session snapshot unwritable (${(e as Error).message})`;
    }
  }

  private restore(): void {
    const snap = readSessionSnapshot(this.opts.persistPath);
    for (const r of snap?.sessions ?? []) this.sessions.set(r.sessionId, r);
  }
}

/** Read a snapshot written by a SessionRegistry in another process. Never throws: a missing or
 *  corrupt file reads as "no sessions known". */
export function readSessionSnapshot(path: string | undefined): SessionSnapshot | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as SessionSnapshot;
    if (s?.version !== 1 || !Array.isArray(s.sessions)) return undefined;
    const sessions = s.sessions.filter((r) => r && typeof r.sessionId === 'string' && typeof r.agentId === 'string' && typeof r.lastActiveTs === 'string');
    return { ...s, sessions };
  } catch { return undefined; }
}

/** Views from a snapshot file, in attention order, for a reader in another process. */
export function sessionViewsFromSnapshot(path: string | undefined, opts: { idleAfterMs?: number; now?: number; includeEnded?: boolean } = {}): SessionView[] {
  const snap = readSessionSnapshot(path);
  if (!snap) return [];
  const now = opts.now ?? Date.now();
  const idle = opts.idleAfterMs ?? 10 * 60_000;
  const views = snap.sessions.map((r) => ({ ...r, state: deriveSessionState(r, now, idle) }));
  return sortByAttention(views.filter((v) => opts.includeEnded || v.state !== 'ended'));
}
