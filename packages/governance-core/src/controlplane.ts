// Vendor-neutral MCP control-plane boundary (ring 1).
//
// An external control plane (Obot or equivalent) may provide routing, registries, credential
// isolation, workload hosting and its own activity log. It does NOT provide authorization.
// Constitutional principle 12: Starfish must remain usable without any particular external product,
// so nothing here imports a vendor SDK and nothing here is required for Starfish to function.
//
// THE ORDER IS FIXED AND IS THE WHOLE POINT:
//
//     Starfish decides  ->  (only if allowed)  forward  ->  response re-enters governance
//
// Two asymmetries follow, and both are enforced by admitMcpCall():
//
//   * A control plane's "allowed" NEVER overrides a Starfish deny. Authorization is not a vote.
//   * A control plane's "denied" DOES stop an otherwise-allowed call. Denials compose; grants do
//     not. A second opinion may subtract authority, never add it. This is the same monotonicity
//     that inquiry.ts applies to semantic signals (docs/adr/0002-semantic-signal-boundary.md).
//
// AN EXTERNAL AUDIT ID IS NOT EVIDENCE. Obot's activity log records that a call was made. It does
// not establish that the claimed real-world effect occurred, which is what GOVERNANCE.md principle
// 6 ("no unbacked word") requires. External identifiers are CORRELATED into the Starfish record
// (McpInvocation.externalAuditId) so a reviewer can pivot between the two ledgers; they never
// substitute for the hash-chained Starfish entry.

import type { Decision, RiskTier, ToolCategory } from './types';
import { sha256 } from './hash';

export const CONTROL_PLANE_SCHEMA = 'starfish.mcp-controlplane' as const;
export const CONTROL_PLANE_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Registry provenance. An entry that cannot prove what it is does not become executable.
// ---------------------------------------------------------------------------

/** Lifecycle of a registry entry. Only 'approved' is executable, and only while unexpired. */
export type RegistryApproval = 'pending' | 'approved' | 'rejected' | 'revoked';

export const REGISTRY_APPROVALS: readonly RegistryApproval[] = ['pending', 'approved', 'rejected', 'revoked'] as const;

/** Where an entry is allowed to run. An entry approved for 'dev' is not thereby approved for 'prod'. */
export type DeployEnvironment = 'dev' | 'staging' | 'prod';

/** Isolation the entry requires. 'none' is deliberately absent: everything is sandboxed somehow.
 *  'docker-sibling' is listed so it can be REFUSED for prod — a sibling container sharing the host
 *  daemon is not an isolation boundary, and the Obot Docker quick start mounts the host socket. */
export type SandboxRequirement = 'in-process' | 'docker-sibling' | 'container-isolated' | 'kubernetes' | 'vm';

/** Sandboxes that are NOT acceptable in prod, whatever a registry entry claims. */
export const PROD_FORBIDDEN_SANDBOXES: readonly SandboxRequirement[] = ['in-process', 'docker-sibling'] as const;

export interface RegistryProvenance {
  id: string;
  version: string;
  sourceRepo?: string;
  sourceCommit?: string;
  /** Hash of the package or content actually admitted. Absence is disqualifying — an entry whose
   *  content cannot be pinned cannot be said to have been reviewed. */
  contentHash: string;
  licence?: string;
  owner: string;
  approval: RegistryApproval;
  environments: readonly DeployEnvironment[];
  /** Principals (users or groups) permitted to reach this entry. Empty means nobody. */
  allowedPrincipals: readonly string[];
  riskTier: RiskTier;
  requiresNetwork: boolean;
  /** Opaque reference resolved by the control plane. NEVER a secret value — see assertNoPlaintextSecret. */
  credentialRef?: string;
  sandbox: SandboxRequirement;
  /** ISO date. Past this the entry is treated as unapproved until re-reviewed. */
  reviewExpiresAt?: string;
  /** Evidence the entry must produce for a consequential call to be completable. */
  evidenceRequirements: readonly string[];
}

export interface McpServerRef extends RegistryProvenance {
  endpointRef: string;
}

export interface McpToolRef extends RegistryProvenance {
  serverId: string;
  effect: ToolCategory;
  /** Three-valued on purpose. A tool type that cannot express an approval requirement yields
   *  'unknown', which is NOT the same as 'ungated' and must not be reported as one. Accusing a tool
   *  that is gated in the calling app is how a report loses the room. */
  gated: boolean | 'unknown';
}

// ---------------------------------------------------------------------------
// Credential hygiene. A ref is a pointer; if it looks like a secret it is rejected outright rather
// than logged and passed on, because by the time it is logged the damage is done.
// ---------------------------------------------------------------------------

const SECRETISH = /(^|[^A-Za-z0-9])(sk-|ghp_|github_pat_|xox[baprs]-|AKIA|ASIA|eyJ[A-Za-z0-9_-]{8,}|-----BEGIN)/;

/** True when the string looks like a credential VALUE rather than a reference to one.
 *  Conservative by design: a reference is expected to be a short readable name such as
 *  `kv://contoso/crm-token`, so anything that is either a known credential prefix or a long opaque
 *  token-shaped blob is treated as a value and refused. A false positive costs an operator a
 *  rename; a false negative leaks a secret into a registry entry. */
export function looksLikeSecret(s: string): boolean {
  if (!s) return false;
  if (SECRETISH.test(s)) return true;
  // A long, unbroken, base64/hex-alphabet blob with no path or scheme separators is a value.
  const opaque = /^[A-Za-z0-9+/_=-]+$/.test(s);
  return opaque && s.length >= 40;
}

// ---------------------------------------------------------------------------
// Admission. Composes the Starfish decision with registry state. This is the function that must be
// correct; everything else in the file is plumbing around it.
// ---------------------------------------------------------------------------

export interface McpAdmission {
  ok: boolean;
  reason: string;
  /** Deterministic, ordered trail of every condition consulted. */
  reasons: readonly string[];
}

export interface ExternalOpinion {
  /** What the control plane says. Advisory when permissive, binding when restrictive. */
  allowed: boolean;
  reason?: string;
  externalAuditId?: string;
}

/**
 * Decide whether an MCP call may be forwarded.
 *
 * `starfish` is the authoritative decision, already made by the PDP. This function can only ever
 * SUBTRACT from it. There is no argument, and no combination of registry state or external
 * opinion, that turns a Starfish deny into an admission.
 */
export function admitMcpCall(
  starfish: Decision,
  entry: RegistryProvenance,
  opts: { environment: DeployEnvironment; principal: string; nowIso: string; external?: ExternalOpinion },
): McpAdmission {
  const reasons: string[] = [];
  const deny = (reason: string): McpAdmission => { reasons.push(reason); return { ok: false, reason, reasons }; };

  // 1. Starfish first, always. A deny or an unresolved ask is terminal here.
  if (!starfish.allow) {
    return deny(starfish.ask
      ? 'starfish requires approval — an unresolved ask is not an authorization'
      : `starfish denied: ${starfish.reason}`);
  }
  reasons.push('starfish allowed');

  // 2. Registry state.
  if (entry.approval !== 'approved') return deny(`registry entry is ${entry.approval}, not approved`);
  if (entry.reviewExpiresAt) {
    const exp = Date.parse(entry.reviewExpiresAt);
    const now = Date.parse(opts.nowIso);
    if (!Number.isFinite(exp) || !Number.isFinite(now)) return deny('registry entry has an unparseable review expiry (fail-closed)');
    if (now >= exp) return deny('registry entry review has expired — re-review required');
  }
  if (!entry.contentHash) return deny('registry entry has no contentHash — unverifiable entries are not executable');
  reasons.push('registry entry approved and unexpired');

  // 3. Environment and principal.
  if (!entry.environments.includes(opts.environment)) return deny(`entry is not approved for environment "${opts.environment}"`);
  if (!entry.allowedPrincipals.includes(opts.principal)) return deny(`principal "${opts.principal}" is not permitted for this entry`);
  reasons.push(`permitted for ${opts.environment}/${opts.principal}`);

  // 4. Sandbox. Refused for prod regardless of what the entry claims about itself.
  if (opts.environment === 'prod' && PROD_FORBIDDEN_SANDBOXES.includes(entry.sandbox)) {
    return deny(`sandbox "${entry.sandbox}" is not an isolation boundary and is refused in prod`);
  }
  reasons.push(`sandbox ${entry.sandbox} acceptable for ${opts.environment}`);

  // 5. Credential hygiene.
  if (entry.credentialRef && looksLikeSecret(entry.credentialRef)) {
    return deny('credentialRef looks like a secret VALUE, not a reference — refused');
  }

  // 6. External opinion. Subtractive only.
  if (opts.external && !opts.external.allowed) {
    return deny(`external control plane denied: ${opts.external.reason ?? 'no reason given'}`);
  }
  if (opts.external) reasons.push('external control plane concurred (advisory — it did not grant anything)');

  return { ok: true, reason: 'admitted', reasons };
}

// ---------------------------------------------------------------------------
// The provider boundary.
// ---------------------------------------------------------------------------

export interface McpForwardRequest {
  /** Required. No task, no tool — GOVERNANCE.md principle 2. */
  taskId: string;
  /** The Starfish-side identity of this invocation, minted before forwarding so a lost response is
   *  still correlatable. */
  invocationId: string;
  serverId: string;
  toolId: string;
  input: Readonly<Record<string, unknown>>;
  principal: string;
}

export interface McpForwardResult {
  ok: boolean;
  /** The control plane's own request id, for cross-ledger correlation. Never authorization. */
  remoteInvocationId?: string;
  externalAuditId?: string;
  status: number;
  body: unknown;
  /** True when the call was dispatched but no response was observed. Distinct from ok:false —
   *  "we do not know" is not "it did not happen", and completion logic must treat them apart. */
  lost?: boolean;
}

export interface McpHealth { ok: boolean; reason: string; }

export interface McpControlPlane {
  readonly id: string;
  listServers(): readonly McpServerRef[];
  listTools(serverId: string): readonly McpToolRef[];
  health(): McpHealth;
  forward(req: McpForwardRequest): McpForwardResult;
}

/** Record of one governed invocation. Correlates the Starfish identity with the external one so an
 *  auditor can pivot between ledgers without either being authoritative for the other. */
export interface McpInvocation {
  schema: typeof CONTROL_PLANE_SCHEMA;
  schemaVersion: typeof CONTROL_PLANE_SCHEMA_VERSION;
  invocationId: string;
  taskId: string;
  serverId: string;
  toolId: string;
  principal: string;
  admitted: boolean;
  admissionReason: string;
  /** Present only when forwarded. */
  remoteInvocationId?: string;
  externalAuditId?: string;
  outcome: 'not-forwarded' | 'forwarded-ok' | 'forwarded-error' | 'forwarded-lost';
  inputCommitment: string;
  at: string;
}

/**
 * Forward under governance. A refused admission NEVER reaches the control plane, so "the gateway
 * said yes" cannot be manufactured by sending a request that should not have been sent.
 */
export function forwardGoverned(
  plane: McpControlPlane,
  req: McpForwardRequest,
  starfish: Decision,
  entry: RegistryProvenance,
  opts: { environment: DeployEnvironment; nowIso: string; external?: ExternalOpinion },
): { invocation: McpInvocation; result?: McpForwardResult; admission: McpAdmission } {
  const admission = admitMcpCall(starfish, entry, {
    environment: opts.environment, principal: req.principal, nowIso: opts.nowIso, external: opts.external,
  });
  const inputCommitment = sha256(JSON.stringify({ serverId: req.serverId, toolId: req.toolId, input: req.input }));
  const base: McpInvocation = {
    schema: CONTROL_PLANE_SCHEMA,
    schemaVersion: CONTROL_PLANE_SCHEMA_VERSION,
    invocationId: req.invocationId,
    taskId: req.taskId,
    serverId: req.serverId,
    toolId: req.toolId,
    principal: req.principal,
    admitted: admission.ok,
    admissionReason: admission.reason,
    outcome: 'not-forwarded',
    inputCommitment,
    at: opts.nowIso,
  };
  if (!admission.ok) return { invocation: base, admission };

  let result: McpForwardResult;
  try {
    result = plane.forward(req);
  } catch {
    // A throw is "we do not know", not "it did not happen".
    return {
      invocation: { ...base, outcome: 'forwarded-lost' },
      result: { ok: false, status: 0, body: null, lost: true },
      admission,
    };
  }
  const outcome: McpInvocation['outcome'] = result.lost ? 'forwarded-lost' : result.ok ? 'forwarded-ok' : 'forwarded-error';
  return {
    invocation: {
      ...base, outcome,
      remoteInvocationId: result.remoteInvocationId,
      externalAuditId: result.externalAuditId,
    },
    result,
    admission,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fake, for tests. No network, no vendor.
// ---------------------------------------------------------------------------

export class FakeMcpControlPlane implements McpControlPlane {
  readonly id: string;
  calls: McpForwardRequest[] = [];
  private servers: McpServerRef[];
  private tools: McpToolRef[];
  private healthState: McpHealth;
  private responder: (req: McpForwardRequest) => McpForwardResult;

  constructor(opts: {
    id?: string;
    servers?: McpServerRef[];
    tools?: McpToolRef[];
    health?: McpHealth;
    responder?: (req: McpForwardRequest) => McpForwardResult;
  } = {}) {
    this.id = opts.id ?? 'fake-control-plane';
    this.servers = opts.servers ?? [];
    this.tools = opts.tools ?? [];
    this.healthState = opts.health ?? { ok: true, reason: 'fake is healthy' };
    this.responder = opts.responder ?? ((r) => ({
      ok: true,
      status: 200,
      body: { echoed: r.toolId },
      remoteInvocationId: `remote-${r.invocationId}`,
      externalAuditId: `ext-audit-${r.invocationId}`,
    }));
  }

  listServers(): readonly McpServerRef[] { return this.servers; }
  listTools(serverId: string): readonly McpToolRef[] { return this.tools.filter((t) => t.serverId === serverId); }
  health(): McpHealth { return this.healthState; }
  forward(req: McpForwardRequest): McpForwardResult { this.calls.push(req); return this.responder(req); }
}
