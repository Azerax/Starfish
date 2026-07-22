// F28/F29 — the privileged-IPC WIRING is now tested, not just the authority primitive. These drive the
// exact functions the Electron main handlers call, with fake deps, and prove: no token → refused and the
// underlying action is NEVER invoked; a valid token → the operator is main-assigned and the broker gets
// the operator-set; and irreversible ops (purge/destructive delete) require the trusted-path confirmation
// (the renderer-RCE residual closure) — a declined confirmation blocks the action.
import { describe, it, expect, vi } from 'vitest';
import { IpcAuthority } from './ipcauthority';
import {
  privilegedApproveOrDeny, privilegedResume, privilegedSetTolerance, privilegedDelete, privilegedPurge,
  type PrivilegedDeps,
} from './privilegedipc';

function deps(over: Partial<PrivilegedDeps> = {}, integrityOk = true): { d: PrivilegedDeps; auth: IpcAuthority; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const auth = new IpcAuthority({ operator: 'scott', integrityOk: () => integrityOk });
  const spies = {
    resolve: vi.fn(() => ({ ok: true, reason: 'ok' })),
    enableCapability: vi.fn(),
    resumeAgent: vi.fn(),
    setTolerance: vi.fn(() => ({ ok: true, value: 'medium' as const, reason: 'ok' })),
    applyTolerance: vi.fn(),
    doDelete: vi.fn(() => ({ ok: true, reason: 'trashed' })),
    doPurge: vi.fn(() => true),
    audit: vi.fn(),
    confirm: vi.fn(() => true),
  };
  const d: PrivilegedDeps = {
    authority: auth,
    trustedConfirm: spies.confirm as never,
    audit: spies.audit as never,
    broker: { get: () => undefined, resolve: spies.resolve as never },
    enableCapability: spies.enableCapability as never,
    resumeAgent: spies.resumeAgent as never,
    setTolerance: spies.setTolerance as never,
    applyTolerance: spies.applyTolerance as never,
    doDelete: spies.doDelete as never,
    doPurge: spies.doPurge as never,
    ...over,
  };
  return { d, auth, spies };
}

describe('F28 wiring — approve/deny/resume/tolerance authorize BEFORE acting', () => {
  it('approve with NO token is refused and the broker is never called', () => {
    const { d, spies } = deps();
    const r = privilegedApproveOrDeny(d, { decisionId: 'x', kind: 'approve' });   // no token
    expect(r.ok).toBe(false);
    expect(spies.resolve).not.toHaveBeenCalled();                                  // the action did not happen
  });

  it('approve with a valid token resolves as the MAIN-owned operator, with the operator-set enforced', () => {
    const { d, auth, spies } = deps();
    const r = privilegedApproveOrDeny(d, { decisionId: 'x', kind: 'approve', token: auth.sessionToken() });
    expect(r.ok).toBe(true);
    expect(spies.resolve).toHaveBeenCalledWith('x', 'approve', 'scott', ['scott']);  // operator not renderer-supplied
  });

  it('a tampered renderer refuses every privileged op even with a valid token', () => {
    const { d, auth, spies } = deps({}, /* integrityOk */ false);
    expect(privilegedApproveOrDeny(d, { decisionId: 'x', kind: 'approve', token: auth.sessionToken() }).ok).toBe(false);
    expect(privilegedResume(d, { agentId: 'w', token: auth.sessionToken() }).ok).toBe(false);
    expect(privilegedSetTolerance(d, { next: 'medium', token: auth.sessionToken() }).ok).toBe(false);
    expect(spies.resolve).not.toHaveBeenCalled();
    expect(spies.resumeAgent).not.toHaveBeenCalled();
    expect(spies.applyTolerance).not.toHaveBeenCalled();
  });

  it('raising tolerance requires the token; the renderer confirmed-flag alone is not authority', () => {
    const { d, spies } = deps();
    const noTok = privilegedSetTolerance(d, { next: 'medium', confirmed: true });   // confirmed but no token
    expect(noTok.ok).toBe(false);
    expect(spies.applyTolerance).not.toHaveBeenCalled();
  });

  it('resume requires the token', () => {
    const { d, auth, spies } = deps();
    expect(privilegedResume(d, { agentId: 'w' }).ok).toBe(false);
    expect(privilegedResume(d, { agentId: 'w', token: auth.sessionToken() }).ok).toBe(true);
    expect(spies.resumeAgent).toHaveBeenCalledWith('w', 'scott');
  });
});

describe('F29 wiring — irreversible ops require the trusted-path confirmation (renderer-RCE residual)', () => {
  it('purge with a valid token but a DECLINED trusted confirmation does not purge', () => {
    const { d, auth, spies } = deps({ trustedConfirm: (() => false) as never });
    const r = privilegedPurge(d, { id: 't1', confirm: true, token: auth.sessionToken() });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('trusted confirmation');
    expect(spies.doPurge).not.toHaveBeenCalled();      // the irreversible action was blocked
  });

  it('purge proceeds only with token AND trusted confirmation', () => {
    const { d, auth, spies } = deps();
    const r = privilegedPurge(d, { id: 't1', confirm: true, token: auth.sessionToken() });
    expect(r.ok).toBe(true);
    expect(spies.doPurge).toHaveBeenCalledWith('t1');
  });

  it('purge with no token never reaches the trusted-confirm or the purge', () => {
    const { d, spies } = deps();
    expect(privilegedPurge(d, { id: 't1', confirm: true }).ok).toBe(false);
    expect(spies.confirm).not.toHaveBeenCalled();
    expect(spies.doPurge).not.toHaveBeenCalled();
  });

  it('a destructive (approved) delete requires token + trusted confirmation', () => {
    const { d, auth, spies } = deps({ trustedConfirm: (() => false) as never });
    const r = privilegedDelete(d, { path: '/proj/x', approved: true, token: auth.sessionToken() });
    expect(r.ok).toBe(false);
    expect(spies.doDelete).not.toHaveBeenCalled();
  });

  it('a non-destructive (soft/assess) delete does not demand the trusted path', () => {
    const { d, spies } = deps();
    const r = privilegedDelete(d, { path: '/proj/x', approved: false });   // no approved → soft path
    expect(r.ok).toBe(true);
    expect(spies.doDelete).toHaveBeenCalledWith('/proj/x', false, false);
  });
});
