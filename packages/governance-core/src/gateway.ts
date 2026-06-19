// External-source gateway (P3) — the governed seam for talking to admitted sources. Two faces:
//   governedIngress: admit-check -> fetch/read -> SCREEN the returned content -> hand back a TAINTED
//     Signal (injection neutralized). The host wraps every MCP call / web fetch / file read with this.
//   governedEgress: the destination must itself be an admitted source (deny-by-default outbound), then
//     the egress-taint gate decides whether tainted data may leave to it.
// Deterministic; the actual fetch is injected so core stays network-free + testable.
import { type SourceRef } from './sources';
import type { SourceRegistry } from './sources';
import { screenIngress, egressTaintGate, taintedSignal, type Signal } from './taint';
import type { AuditLog } from './audit';

export interface IngressDeps { sources: SourceRegistry; audit?: AuditLog; agentId?: string }
export interface IngressResult { allowed: boolean; signal?: Signal; reason: string; injectionNeutralized: boolean }

/** Reach an external source and bring its content back as TAINTED, injection-screened data. */
export async function governedIngress(source: SourceRef, fetcher: () => Promise<string> | string, deps: IngressDeps): Promise<IngressResult> {
  const ad = deps.sources.admit(source);
  if (!ad.allow) {
    deps.audit?.append({ actor: deps.agentId ?? 'system', domain: 'governance', action: 'ingress-denied', target: source.id, decision: 'deny', reason: ad.reason });
    return { allowed: false, reason: ad.reason, injectionNeutralized: false };
  }
  let raw: string;
  try { raw = await fetcher(); }
  catch (e) { return { allowed: false, reason: `fetch-failed: ${(e as Error).message}`, injectionNeutralized: false }; }

  const screen = screenIngress(raw, { sourceRef: source, audit: deps.audit, actor: deps.agentId });
  const content = screen.ok ? raw : screen.sanitized;   // injection-laden content comes back neutralized
  return { allowed: true, signal: taintedSignal(source, content), reason: screen.ok ? 'admitted; content tainted' : 'admitted; injection neutralized', injectionNeutralized: !screen.ok };
}

export interface EgressDeps { sources: SourceRegistry; audit?: AuditLog; agentId?: string; allowlist?: (SourceRef | string)[] }
export interface EgressResult { allow: boolean; reason: string }

/** Send outbound: the destination must be an admitted source (deny-by-default), then the taint gate. */
export function governedEgress(opts: { tainted: boolean; toDestination: SourceRef | string; fromSource?: SourceRef }, deps: EgressDeps): EgressResult {
  const destRef: SourceRef = typeof opts.toDestination === 'string' ? { kind: 'http', id: opts.toDestination } : opts.toDestination;
  const ad = deps.sources.admit(destRef);
  if (!ad.allow) {
    deps.audit?.append({ actor: deps.agentId ?? 'system', domain: 'governance', action: 'egress-denied', target: destRef.id, decision: 'deny', reason: `destination not admitted: ${ad.reason}` });
    return { allow: false, reason: `destination not admitted: ${ad.reason}` };
  }
  return egressTaintGate({ tainted: opts.tainted, fromSource: opts.fromSource, toDestination: opts.toDestination, allowlist: deps.allowlist, audit: deps.audit, actor: deps.agentId });
}
