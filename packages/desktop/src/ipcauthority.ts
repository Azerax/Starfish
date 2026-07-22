// IPC authority (F28/F29). Electron IPC gives the main process no way to authenticate the caller, so
// the desktop app previously TRUSTED renderer-supplied authority fields: `req.actor` on an approval and
// a `confirmed`/`confirm` boolean on tolerance changes and permanent deletes. Any renderer code could
// therefore claim to be the operator and self-approve.
//
// This module makes authority MAIN-OWNED and non-forgeable-from-the-renderer:
//   1. The operator principal is assigned by main (from the installed operator identity), never read
//      from the IPC payload. A renderer cannot claim to be someone else.
//   2. Privileged operations require a capability TOKEN minted by main at startup and handed to the
//      renderer only through the preload channel. A different origin / frame / webview / injected
//      context that never went through our preload cannot present it. (This is one layer: code running
//      in our OWN verified renderer can read the token — which is why renderer-bundle integrity + CSP +
//      sandbox, see rendererintegrity.ts, are the companion layers that stop foreign code running there
//      at all.)
//   3. An integrity predicate (the renderer guard) gates every privileged op: if the renderer bundle is
//      tampered, privileged IPC is refused regardless of token.
//
// Pure + testable: no Electron. The app wires `operator` from the install, `token` into the preload, and
// `integrityOk` to the renderer guard.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export type PrivilegedOp = 'approve' | 'deny' | 'setRiskTolerance' | 'delete' | 'purge';

export interface AuthorityRequest {
  op: PrivilegedOp;
  token?: unknown;        // capability token presented by the caller (from the preload)
}

export interface AuthorityVerdict {
  allow: boolean;
  operator?: string;      // the MAIN-assigned operator principal to attribute the action to
  reason: string;
}

export interface IpcAuthorityDeps {
  operator: string;                 // the installed operator identity (main-owned)
  integrityOk: () => boolean;       // renderer-bundle integrity gate (rendererintegrity.guardRenderer)
}

export class IpcAuthority {
  private readonly token: string;
  constructor(private deps: IpcAuthorityDeps) {
    this.token = randomBytes(32).toString('hex');   // per-process capability token
  }

  /** The token to hand the renderer via the preload (NEVER logged, never in audit). */
  sessionToken(): string { return this.token; }

  private tokenOk(presented: unknown): boolean {
    if (typeof presented !== 'string' || presented.length !== this.token.length) return false;
    try { return timingSafeEqual(Buffer.from(presented), Buffer.from(this.token)); } catch { return false; }
  }

  /**
   * Authorize a privileged IPC call. Order is fail-closed:
   *   integrity → token → (operator assigned by main). The renderer supplies NOTHING authoritative —
   *   not the actor, not a confirmed flag. The returned `operator` is what the caller must attribute the
   *   action to (and pass to the broker's operator-set), so a self-approval is impossible: the approver
   *   is always the main-owned operator, checked against proposer≠approver downstream.
   */
  authorize(req: AuthorityRequest): AuthorityVerdict {
    if (!this.deps.integrityOk()) return { allow: false, reason: 'renderer integrity check failed — privileged IPC refused' };
    if (!this.tokenOk(req.token)) return { allow: false, reason: 'missing/invalid capability token — call did not originate from the trusted preload' };
    return { allow: true, operator: this.deps.operator, reason: 'authorized' };
  }
}
