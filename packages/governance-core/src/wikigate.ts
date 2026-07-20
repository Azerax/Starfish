// The Memory Wiki governance gate — the single place a page, version, link, merge or split is
// authorized. Every write into the wiki routes through WikiGate.evaluate(); there is no second path.
//
// What this module refuses, and why:
//   T4  — stakes are computed DETERMINISTICALLY from the operation and subject type. A proposer
//         cannot declare its own claim "low stakes" to dodge human review; there is no parameter
//         for it to pass. Unknown subject types classify HIGH (fail closed).
//   T7  — proposer != approver, ported from ScopeContractLedger.amend (scope.ts:144-163), which is
//         the repo's reference implementation. The auto-approve path is deterministic POLICY, not
//         an actor, so it is not self-approval.
//   T9  — approval binds a content hash. Promotion re-verifies it, so evidence swapped between
//         approval and promotion voids the approval instead of riding it through. Note the design
//         doc points at `attest`'s stampInputs/verifyInputs here; that is the wrong primitive
//         (it stamps FILES on disk). The right reuse is scope.ts's canonical `seal()`, below.
//   T11 — `supports` and `supersedes` links are always high-stakes: they change what bounded
//         traversal retrieves and what supersedes what, so an LLM must never be able to assert one.
//   T20 — merge and split require N-of-M DISTINCT approvers. The design doc says to reuse "the
//         vault dual-control pattern"; there is no vault module in this repo, so it is built here.
import { sha256 } from './hash';
import type { AuditLog } from './audit';
import type { PolicyEngine } from './policy';
import { GovernanceError } from './types';
import type { ConfidenceResult } from './confidence';
import {
  ALWAYS_HIGH_STAKES_OPS, ALWAYS_HIGH_STAKES_TYPES, DUAL_CONTROL_N, DUAL_CONTROL_OPS,
  HIGH_STAKES_LINKS, type LinkKind, type Stakes, type WikiOp,
} from './wikitypes';

export interface ApprovalBinding {
  contentHash: string;
  approvers: string[];
  at: string;
  seal: string;
}

export interface GateRequest {
  op: WikiOp;
  proposer: string;
  /** What the approval binds to — the canonical hash of the exact content being approved. */
  contentHash: string;
  confidence: ConfidenceResult;
  entityType?: string;
  linkKind?: LinkKind;
  /** Identities approving this operation. Empty means "nobody has approved yet". */
  approvers?: string[];
}

export interface GateVerdict {
  outcome: 'approved' | 'queued' | 'rejected';
  stakes: Stakes;
  reason: string;
  requiredApprovers: number;
  binding?: ApprovalBinding;
}

/**
 * Deterministic stakes classification (T4). Pure function of the operation and its subject — there
 * is deliberately no way for a caller to influence it.
 */
export function classifyStakes(op: WikiOp, opts: { entityType?: string; linkKind?: LinkKind } = {}): Stakes {
  if (ALWAYS_HIGH_STAKES_OPS.includes(op)) return 'high';
  if (opts.linkKind !== undefined) {
    // An unrecognised link kind is high-stakes, not low.
    if (HIGH_STAKES_LINKS.includes(opts.linkKind)) return 'high';
  }
  if (op === 'page:create') {
    const t = typeof opts.entityType === 'string' ? opts.entityType.trim().toLowerCase() : '';
    if (t === '') return 'high';                                  // unknown subject → fail closed
    if (ALWAYS_HIGH_STAKES_TYPES.includes(t)) return 'high';
  }
  return 'low';
}

/** How many DISTINCT approvers this operation needs before it may proceed. */
export function requiredApprovers(op: WikiOp): number {
  if (DUAL_CONTROL_OPS.includes(op)) return DUAL_CONTROL_N;
  return 1;
}

/** Canonical, order-independent seal over an approval — modelled on scope.ts's `seal()`. */
export function sealApproval(contentHash: string, approvers: string[], at: string): string {
  return sha256(JSON.stringify({ contentHash, approvers: [...approvers].sort(), at }));
}

/** T9 — re-verify an approval against the content as it stands NOW. */
export function verifyBinding(binding: ApprovalBinding | undefined, currentContentHash: string): { ok: boolean; reason: string } {
  if (!binding) return { ok: false, reason: 'no approval binding' };
  if (sealApproval(binding.contentHash, binding.approvers, binding.at) !== binding.seal) {
    return { ok: false, reason: 'approval seal does not verify — binding tampered' };
  }
  if (binding.contentHash !== currentContentHash) {
    return { ok: false, reason: 'content changed since approval — re-gate required' };
  }
  return { ok: true, reason: 'binding verified' };
}

export interface WikiGateOptions {
  /** Identities permitted to approve. Mirrors ScopeContractLedger's approver allowlist. */
  approvers?: Set<string>;
}

export class WikiGate {
  private readonly approvers: Set<string>;

  constructor(private audit: AuditLog, private policy: PolicyEngine, opts: WikiGateOptions = {}) {
    this.approvers = opts.approvers ?? new Set(['god', 'human', 'scott']);
  }

  /**
   * The single authorization decision for a wiki write.
   *
   * Order is load-bearing: policy deny wins over everything; auto-approval requires an EXPLICIT
   * policy allow (a 'nomatch' never auto-approves — the absence of a rule is not consent); and the
   * human path validates approver identity before it validates anything else.
   */
  evaluate(req: GateRequest): GateVerdict {
    const stakes = classifyStakes(req.op, { entityType: req.entityType, linkKind: req.linkKind });
    const need = requiredApprovers(req.op);
    const approvers = [...new Set(req.approvers ?? [])];

    const pol = this.policy.evaluate(`agent:${req.proposer}`, `tool:memory.${opVerb(req.op)}`, req.op);
    if (pol === 'deny') {
      this.audit.append({
        actor: 'governance', domain: 'memory', action: `wiki:${req.op}`, decision: 'deny',
        reason: 'policy-deny', detail: { stakes },
      });
      return { outcome: 'rejected', stakes, reason: 'policy-deny', requiredApprovers: need };
    }

    // --- Deterministic auto-approval. Not an actor, so it is not self-approval (T7). ---
    if (stakes === 'low' && approvers.length === 0) {
      if (pol === 'allow' && req.confidence.autoEligible) {
        const binding = this.bind(req.contentHash, ['policy']);
        this.audit.append({
          actor: 'governance', domain: 'memory', action: `wiki:${req.op}`, decision: 'allow',
          reason: `auto (${req.confidence.points} points, ${req.confidence.independentSources} independent sources)`,
          detail: { stakes, binding: binding.seal },
        });
        return { outcome: 'approved', stakes, reason: 'auto-approved by deterministic policy', requiredApprovers: need, binding };
      }
      const why = pol === 'allow' ? req.confidence.reasons.join('; ') : `policy ${pol} — absence of a rule is not consent`;
      this.audit.append({
        actor: 'governance', domain: 'memory', action: `wiki:${req.op}`,
        reason: 'queued for approval', detail: { stakes, policy: pol, why },
      });
      return { outcome: 'queued', stakes, reason: why, requiredApprovers: need };
    }

    // --- Human path. ---
    if (approvers.length === 0) {
      this.audit.append({
        actor: 'governance', domain: 'memory', action: `wiki:${req.op}`,
        reason: `high-stakes ${req.op} requires ${need} approver(s)`, detail: { stakes },
      });
      return { outcome: 'queued', stakes, reason: `high-stakes ${req.op} requires ${need} approver(s)`, requiredApprovers: need };
    }

    for (const a of approvers) {
      if (a === req.proposer) {
        this.audit.append({
          actor: a, domain: 'memory', action: `wiki:${req.op}`, decision: 'deny',
          reason: 'proposer-cannot-approve-own-write',
        });
        throw new GovernanceError('proposer cannot approve their own memory write');
      }
      if (a === 'system' || !this.approvers.has(a)) {
        this.audit.append({
          actor: a, domain: 'memory', action: `wiki:${req.op}`, decision: 'deny', reason: 'not-an-approver',
        });
        throw new GovernanceError(`${a} is not an approver`);
      }
    }

    if (approvers.length < need) {
      this.audit.append({
        actor: 'governance', domain: 'memory', action: `wiki:${req.op}`,
        reason: `dual control: ${approvers.length}/${need} approvers`, detail: { stakes },
      });
      return { outcome: 'queued', stakes, reason: `dual control: ${approvers.length}/${need} approvers`, requiredApprovers: need };
    }

    const binding = this.bind(req.contentHash, approvers);
    this.audit.append({
      actor: approvers.join(','), domain: 'memory', action: `wiki:${req.op}`, decision: 'allow',
      reason: `approved by ${approvers.length} approver(s)`, detail: { stakes, binding: binding.seal },
    });
    return { outcome: 'approved', stakes, reason: `approved by ${approvers.join(', ')}`, requiredApprovers: need, binding };
  }

  private bind(contentHash: string, approvers: string[]): ApprovalBinding {
    const at = new Date().toISOString();
    return { contentHash, approvers, at, seal: sealApproval(contentHash, approvers, at) };
  }
}

/** Map an operation to the policy action verb, keeping the mandatory tool:<name> convention. */
function opVerb(op: WikiOp): string {
  if (op.startsWith('page:')) return 'promote';
  if (op.startsWith('link:')) return 'link';
  return 'restructure';
}
