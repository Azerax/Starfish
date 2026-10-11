import { describe, it, expect } from 'vitest';
import {
  admitMcpCall, forwardGoverned, looksLikeSecret, FakeMcpControlPlane,
  CONTROL_PLANE_SCHEMA, PROD_FORBIDDEN_SANDBOXES,
} from './controlplane';
import type { RegistryProvenance, McpForwardRequest, DeployEnvironment, McpToolRef } from './controlplane';
import type { Decision } from './types';

// The control-plane boundary. The properties under test are the asymmetries:
//   * an external "allowed" never overrides a Starfish deny
//   * an external "denied" DOES stop an otherwise-allowed call — denials compose, grants do not
//   * a refused admission never reaches the plane at all
//   * a lost response is "we do not know", never "it did not happen"
// See docs/adr/0002-semantic-signal-boundary.md.

const NOW = '2026-09-26T12:00:00.000Z';

const ALLOW: Decision = { allow: true, reason: 'ok' };
const DENY: Decision = { allow: false, reason: 'boundary-violation' };
const ASK: Decision = { allow: false, ask: true, reason: 'risk ceiling exceeded', askOrigin: 'risk' };

function entry(over: Partial<RegistryProvenance> = {}): RegistryProvenance {
  return {
    id: 'srv.crm', version: '1.2.0', contentHash: 'abc123', owner: 'scott',
    approval: 'approved', environments: ['dev', 'prod'], allowedPrincipals: ['scott'],
    riskTier: 'medium', requiresNetwork: true, sandbox: 'kubernetes',
    reviewExpiresAt: '2027-01-01T00:00:00.000Z', evidenceRequirements: ['observed-final-state'],
    ...over,
  };
}

function fwd(over: Partial<McpForwardRequest> = {}): McpForwardRequest {
  return { taskId: 'task-1', invocationId: 'inv-1', serverId: 'srv.crm', toolId: 'crm.create', input: { name: 'x' }, principal: 'scott', ...over };
}

const opts = (over: Partial<{ environment: DeployEnvironment; nowIso: string }> = {}) =>
  ({ environment: 'prod' as DeployEnvironment, nowIso: NOW, ...over });

// ---------------------------------------------------------------------------

describe('Starfish decides first, and an external opinion cannot add authority', () => {
  it('an external ALLOW cannot override a Starfish DENY', () => {
    const a = admitMcpCall(DENY, entry(), { ...opts(), principal: 'scott', external: { allowed: true, reason: 'gateway says fine' } });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/starfish denied/);
  });

  it('an unresolved ask is not an authorization', () => {
    const a = admitMcpCall(ASK, entry(), { ...opts(), principal: 'scott', external: { allowed: true } });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/requires approval/);
  });

  it('an external DENY stops an otherwise-allowed call — denials compose', () => {
    const a = admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'scott', external: { allowed: false, reason: 'rate limited' } });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/external control plane denied: rate limited/);
  });

  it('an external concurrence is recorded as advisory, not as a grant', () => {
    const a = admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'scott', external: { allowed: true } });
    expect(a.ok).toBe(true);
    expect(a.reasons.join(' ')).toMatch(/did not grant anything/);
  });

  it('Starfish alone is sufficient — no external plane is required', () => {
    expect(admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'scott' }).ok).toBe(true);
  });
});

describe('registry entries fail closed', () => {
  for (const approval of ['pending', 'rejected', 'revoked'] as const) {
    it(`a ${approval} entry is not executable`, () => {
      expect(admitMcpCall(ALLOW, entry({ approval }), { ...opts(), principal: 'scott' }).ok).toBe(false);
    });
  }

  it('an expired review is not executable', () => {
    const a = admitMcpCall(ALLOW, entry({ reviewExpiresAt: '2026-01-01T00:00:00.000Z' }), { ...opts(), principal: 'scott' });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/expired/);
  });

  it('an unparseable expiry fails closed rather than being ignored', () => {
    const a = admitMcpCall(ALLOW, entry({ reviewExpiresAt: 'whenever' }), { ...opts(), principal: 'scott' });
    expect(a.ok).toBe(false);
  });

  it('an entry with no contentHash is not executable', () => {
    expect(admitMcpCall(ALLOW, entry({ contentHash: '' }), { ...opts(), principal: 'scott' }).ok).toBe(false);
  });

  it('an entry not approved for this environment is refused', () => {
    const a = admitMcpCall(ALLOW, entry({ environments: ['dev'] }), { ...opts({ environment: 'prod' }), principal: 'scott' });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/not approved for environment/);
  });

  it('an empty principal list means nobody, not everybody', () => {
    expect(admitMcpCall(ALLOW, entry({ allowedPrincipals: [] }), { ...opts(), principal: 'scott' }).ok).toBe(false);
  });

  it('a principal outside the list is refused', () => {
    expect(admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'someone-else' }).ok).toBe(false);
  });
});

describe('sandbox claims do not license weak isolation in prod', () => {
  it('the host-Docker-socket shape is refused in prod', () => {
    expect(PROD_FORBIDDEN_SANDBOXES).toContain('docker-sibling');
    const a = admitMcpCall(ALLOW, entry({ sandbox: 'docker-sibling' }), { ...opts({ environment: 'prod' }), principal: 'scott' });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/not an isolation boundary/);
  });

  it('in-process is refused in prod', () => {
    expect(admitMcpCall(ALLOW, entry({ sandbox: 'in-process' }), { ...opts({ environment: 'prod' }), principal: 'scott' }).ok).toBe(false);
  });

  it('the same entry is permitted in dev', () => {
    const e = entry({ sandbox: 'docker-sibling', environments: ['dev'] });
    expect(admitMcpCall(ALLOW, e, { ...opts({ environment: 'dev' }), principal: 'scott' }).ok).toBe(true);
  });

  it('kubernetes is acceptable in prod', () => {
    expect(admitMcpCall(ALLOW, entry({ sandbox: 'kubernetes' }), { ...opts(), principal: 'scott' }).ok).toBe(true);
  });
});

describe('credential references are references, not values', () => {
  it('a plausible reference is accepted', () => {
    expect(looksLikeSecret('kv://contoso/crm-token')).toBe(false);
    expect(admitMcpCall(ALLOW, entry({ credentialRef: 'kv://contoso/crm-token' }), { ...opts(), principal: 'scott' }).ok).toBe(true);
  });

  it('known credential prefixes are refused', () => {
    for (const s of ['sk-abcdefghijklmnop', 'ghp_abcdefghijklmnopqrstuvwxyz', 'xoxb-1234-5678-abcdef', 'AKIAIOSFODNN7EXAMPLE', '-----BEGIN PRIVATE KEY-----']) {
      expect(looksLikeSecret(s)).toBe(true);
    }
  });

  it('a long opaque blob is treated as a value', () => {
    expect(looksLikeSecret('a'.repeat(48))).toBe(true);
  });

  it('an entry carrying a secret-shaped credentialRef is refused', () => {
    const a = admitMcpCall(ALLOW, entry({ credentialRef: 'sk-livekey0000000000000000' }), { ...opts(), principal: 'scott' });
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/looks like a secret VALUE/);
  });
});

describe('a refused admission never reaches the control plane', () => {
  it('the plane is not called on a Starfish deny', () => {
    const plane = new FakeMcpControlPlane();
    const out = forwardGoverned(plane, fwd(), DENY, entry(), opts());
    expect(plane.calls).toHaveLength(0);
    expect(out.result).toBeUndefined();
    expect(out.invocation.outcome).toBe('not-forwarded');
    expect(out.invocation.admitted).toBe(false);
  });

  it('the plane is not called on a revoked registry entry', () => {
    const plane = new FakeMcpControlPlane();
    forwardGoverned(plane, fwd(), ALLOW, entry({ approval: 'revoked' }), opts());
    expect(plane.calls).toHaveLength(0);
  });

  it('an admitted call is forwarded exactly once', () => {
    const plane = new FakeMcpControlPlane();
    const out = forwardGoverned(plane, fwd(), ALLOW, entry(), opts());
    expect(plane.calls).toHaveLength(1);
    expect(out.invocation.outcome).toBe('forwarded-ok');
  });
});

describe('correlation survives failure, and a lost response is not a failure', () => {
  it('external identifiers are correlated into the Starfish record', () => {
    const plane = new FakeMcpControlPlane();
    const out = forwardGoverned(plane, fwd(), ALLOW, entry(), opts());
    expect(out.invocation.remoteInvocationId).toBe('remote-inv-1');
    expect(out.invocation.externalAuditId).toBe('ext-audit-inv-1');
    expect(out.invocation.invocationId).toBe('inv-1');
    expect(out.invocation.taskId).toBe('task-1');
    expect(out.invocation.schema).toBe(CONTROL_PLANE_SCHEMA);
  });

  it('a throwing plane yields forwarded-lost, not forwarded-error', () => {
    const plane = new FakeMcpControlPlane({ responder: () => { throw new Error('socket closed'); } });
    const out = forwardGoverned(plane, fwd(), ALLOW, entry(), opts());
    expect(out.invocation.outcome).toBe('forwarded-lost');
    expect(out.result?.lost).toBe(true);
    // The Starfish identity is still present, so the call remains correlatable.
    expect(out.invocation.invocationId).toBe('inv-1');
    expect(out.invocation.inputCommitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an explicit lost flag is distinguished from an error status', () => {
    const lost = new FakeMcpControlPlane({ responder: () => ({ ok: false, status: 0, body: null, lost: true }) });
    const err = new FakeMcpControlPlane({ responder: () => ({ ok: false, status: 500, body: { e: 1 } }) });
    expect(forwardGoverned(lost, fwd(), ALLOW, entry(), opts()).invocation.outcome).toBe('forwarded-lost');
    expect(forwardGoverned(err, fwd(), ALLOW, entry(), opts()).invocation.outcome).toBe('forwarded-error');
  });

  it('the input commitment is deterministic and does not carry the input', () => {
    const plane = new FakeMcpControlPlane();
    const a = forwardGoverned(plane, fwd({ input: { name: 'x' } }), ALLOW, entry(), opts());
    const b = forwardGoverned(plane, fwd({ input: { name: 'x' } }), ALLOW, entry(), opts());
    const c = forwardGoverned(plane, fwd({ input: { name: 'y' } }), ALLOW, entry(), opts());
    expect(a.invocation.inputCommitment).toBe(b.invocation.inputCommitment);
    expect(a.invocation.inputCommitment).not.toBe(c.invocation.inputCommitment);
    expect(JSON.stringify(a.invocation)).not.toContain('"x"');
  });
});

describe('the admission trail is deterministic and ordered', () => {
  it('identical inputs produce an identical trail', () => {
    const first = JSON.stringify(admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'scott' }));
    for (let i = 0; i < 200; i++) {
      expect(JSON.stringify(admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'scott' }))).toBe(first);
    }
  });

  it('the trail names every condition consulted on the happy path', () => {
    const a = admitMcpCall(ALLOW, entry(), { ...opts(), principal: 'scott' });
    const trail = a.reasons.join(' | ');
    expect(trail).toMatch(/starfish allowed/);
    expect(trail).toMatch(/registry entry approved/);
    expect(trail).toMatch(/permitted for prod\/scott/);
    expect(trail).toMatch(/sandbox kubernetes/);
  });
});

describe('the fake plane is a fake, not a network client', () => {
  it('reports health and lists only its own tools', () => {
    const plane = new FakeMcpControlPlane({
      tools: [
        { ...entry({ id: 'crm.create' }), serverId: 'srv.crm', effect: 'write', gated: 'unknown' },
        { ...entry({ id: 'other.read' }), serverId: 'srv.other', effect: 'read', gated: true },
      ],
    });
    expect(plane.health().ok).toBe(true);
    expect(plane.listTools('srv.crm').map((t) => t.id)).toEqual(['crm.create']);
  });

  it('gated is three-valued — unknown is not ungated', () => {
    // Typed as McpToolRef (not narrowed to the literal) so the three-valued contract is the thing
    // under test: a caller reading `gated` must handle 'unknown' distinctly from false.
    const t: McpToolRef = { ...entry({ id: 'crm.create' }), serverId: 'srv.crm', effect: 'write', gated: 'unknown' };
    const ungated: McpToolRef = { ...t, id: 'crm.delete', gated: false };
    expect(t.gated).toBe('unknown');
    expect(t.gated).not.toBe(false);
    expect(ungated.gated).toBe(false);
    // The dangerous collapse: treating unknown as ungated would make these equal.
    expect(t.gated === ungated.gated).toBe(false);
  });
});
