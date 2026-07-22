// Privileged IPC handlers — the authorize-then-act LOGIC for every operation the desktop bridge exposes
// that grants authority (approve/deny a governed decision, resume a paused agent, raise risk tolerance,
// delete a file, permanently purge trash). Extracted from the Electron main closures into pure,
// dependency-injected functions so the wiring itself — "does the handler actually authorize before it
// acts?" — is unit-tested, not merely asserted. main/index.ts is now a thin wrapper that supplies the
// real dependencies (IpcAuthority, the broker, the governor, and a native OS dialog as the trusted path).
//
// Two authority tiers (F28/F29):
//   - Every op requires the capability token + a verified renderer bundle (via IpcAuthority.authorize),
//     and the operator identity is main-assigned, never renderer-supplied.
//   - IRREVERSIBLE ops (permanent purge, destructive delete) additionally require `trustedConfirm` — a
//     main-process confirmation the renderer cannot synthesize even with code execution (the closure for
//     the Chromium-RCE residual). In production this is dialog.showMessageBox; in tests it is a stub.
import type { IpcAuthority, PrivilegedOp } from './ipcauthority';

export interface PrivilegedResult { ok: boolean; reason: string; value?: unknown }

export interface PrivilegedDeps {
  authority: Pick<IpcAuthority, 'authorize'>;
  // A main-process confirmation the renderer cannot forge. Returns true iff a human confirmed.
  trustedConfirm: (op: PrivilegedOp, detail: string) => boolean;
  audit: (e: { action: string; decision: 'allow' | 'deny'; reason: string; target?: string; riskTier?: string }) => void;
  broker: {
    get(id: string): { kind?: string; refId?: string } | undefined;
    resolve(id: string, verdict: 'approve' | 'deny', by: string, operators?: readonly string[]): { ok: boolean; reason: string };
  };
  enableCapability: (refId: string, by: string) => void;   // capabilities.approve
  resumeAgent: (agentId: string, by: string) => void;      // tokens.resume
  setTolerance: (next: 'low' | 'medium', by: string, confirmed: boolean) => { ok: boolean; value: 'low' | 'medium'; reason: string };
  applyTolerance: (value: 'low' | 'medium') => void;
  doDelete: (path: string, recursive: boolean, approved: boolean) => PrivilegedResult;
  doPurge: (id: string) => boolean;
}

/** Authorize a privileged op; returns the main-assigned operator or a refusal. Every function below
 *  goes through this first, so authorization is not something a handler can forget to do. */
function gate(deps: PrivilegedDeps, op: PrivilegedOp, token: unknown): { operator: string } | { refused: string } {
  const v = deps.authority.authorize({ op, token });
  if (!v.allow) {
    deps.audit({ action: `ipc-refused:${op}`, decision: 'deny', reason: v.reason, riskTier: 'high' });
    return { refused: v.reason };
  }
  return { operator: v.operator! };
}

export function privilegedApproveOrDeny(deps: PrivilegedDeps, req: { decisionId?: string; kind: 'approve' | 'deny'; token?: unknown }): PrivilegedResult {
  const auth = gate(deps, req.kind, req.token);
  if ('refused' in auth) return { ok: false, reason: `refused: ${auth.refused}` };
  if (!req.decisionId) return { ok: false, reason: 'no decisionId' };
  const pend = deps.broker.get(req.decisionId);
  // The broker enforces proposer≠approver AND, with the operator-set [operator], that only the
  // main-owned operator can approve — so an agent can never self-approve through this path.
  const r = deps.broker.resolve(req.decisionId, req.kind, auth.operator, [auth.operator]);
  if (r.ok && req.kind === 'approve' && pend?.kind === 'capability' && pend.refId) deps.enableCapability(pend.refId, auth.operator);
  return { ok: r.ok, reason: r.reason, value: r.ok && req.kind === 'approve' };
}

export function privilegedResume(deps: PrivilegedDeps, req: { agentId?: string; token?: unknown }): PrivilegedResult {
  const auth = gate(deps, 'approve', req.token);
  if ('refused' in auth) return { ok: false, reason: `refused: ${auth.refused}` };
  if (!req.agentId) return { ok: false, reason: 'no agentId' };
  deps.resumeAgent(req.agentId, auth.operator);
  return { ok: true, reason: `resumed ${req.agentId}` };
}

export function privilegedSetTolerance(deps: PrivilegedDeps, req: { next: 'low' | 'medium'; confirmed?: boolean; token?: unknown }): PrivilegedResult & { value?: 'low' | 'medium' } {
  const auth = gate(deps, 'setRiskTolerance', req.token);
  if ('refused' in auth) return { ok: false, reason: `refused: ${auth.refused}` };
  const r = deps.setTolerance(req.next, auth.operator, !!req.confirmed);
  if (r.ok) deps.applyTolerance(r.value);
  return { ok: r.ok, reason: r.reason, value: r.value };
}

export function privilegedDelete(deps: PrivilegedDeps, req: { path: string; recursive?: boolean; approved?: boolean; token?: unknown }): PrivilegedResult {
  // A delete carrying approved:true is a privileged self-approval of a destructive op → token + trusted
  // confirmation. An un-approved delete (assess/soft path) still goes through the core gate downstream.
  if (req.approved) {
    const auth = gate(deps, 'delete', req.token);
    if ('refused' in auth) return { ok: false, reason: `refused: ${auth.refused}` };
    if (!deps.trustedConfirm('delete', `Permanently authorize deletion of ${req.path}?`)) {
      deps.audit({ action: 'ipc-refused:delete', decision: 'deny', reason: 'trusted confirmation declined', target: req.path });
      return { ok: false, reason: 'trusted confirmation declined' };
    }
  }
  return deps.doDelete(req.path, !!req.recursive, !!req.approved);
}

export function privilegedPurge(deps: PrivilegedDeps, req: { id: string; confirm?: boolean; token?: unknown }): PrivilegedResult {
  const auth = gate(deps, 'purge', req.token);
  if ('refused' in auth) return { ok: false, reason: `refused: ${auth.refused}` };
  // Permanent + irreversible → the trusted-path confirmation is MANDATORY. This is the layer that
  // survives a renderer RCE: a native OS dialog the exploit cannot click for the user.
  if (!deps.trustedConfirm('purge', `Permanently and irreversibly delete trashed item ${req.id}? This cannot be undone.`)) {
    deps.audit({ action: 'ipc-refused:purge', decision: 'deny', reason: 'trusted confirmation declined', target: req.id });
    return { ok: false, reason: 'trusted confirmation declined' };
  }
  const ok = deps.doPurge(req.id);
  deps.audit({ action: 'trash-purge', decision: 'allow', reason: 'permanent removal (token + trusted confirmation + verified renderer)', target: req.id });
  return { ok, reason: ok ? 'purged' : 'purge failed' };
}
