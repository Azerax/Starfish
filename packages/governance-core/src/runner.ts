// Host send-runner — CLOSES THE LOOP a DispatchPlan opens. It is the ONE place a secret and the
// network meet, so it is dependency-injected and side-effect-isolated:
//   - keyResolver(providerId)  -> the host fetches the key from the OS keychain (core never stores it)
//   - fetcher(url, init)       -> the host's HTTP transport (default global fetch; faked in tests)
// Flow: resolve key -> egress gate (hosted routers need opt-in) -> inject key into a THROWAWAY header
// clone (the plan's request stays key-free) -> send -> parse usage -> record into the TokenGovernor
// (which can trip soft/hard budget for the NEXT route). The API key is NEVER audited, never mutated
// onto the plan, never returned. Governance (PDP/vetting/boundary) is untouched — this only executes
// an already-authorized worker call.
import { GovernanceError } from './types';
import type { ProviderKind, RuntimeRequest } from './provider';
import type { AuditLog } from './audit';
import type { TokenGovernor, BudgetStatus } from './tokens';
import type { DispatchPlan } from './dispatch';

export interface HttpResponse { status: number; ok: boolean; text(): Promise<string>; }
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<HttpResponse>;
export type KeyResolver = (providerId: string) => Promise<string | undefined> | string | undefined;
/** Operator-configured pricing (USD per 1M tokens). Absent => cost recorded as 0 (tokens still counted). */
export type PriceTable = Record<string, { perMTokUsd: number }>;

export interface RunnerDeps {
  tokens: TokenGovernor;
  keyResolver: KeyResolver;
  fetcher?: Fetcher;
  allowEgress?: boolean;     // hosted-router data-egress opt-in (default false)
  prices?: PriceTable;
  audit?: AuditLog;
}
export interface RunResult { ok: boolean; status: number; text: string; tokens: number; usd: number; budget: BudgetStatus; }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Extract token usage from a provider's (parsed) JSON response body, per provider shape. */
export function parseUsage(kind: ProviderKind, body: unknown): { tokens: number } {
  if (!isObj(body)) return { tokens: 0 };
  if (kind === 'anthropic') {
    const u = isObj(body.usage) ? body.usage : {};
    return { tokens: num(u.input_tokens) + num(u.output_tokens) };
  }
  if (kind === 'google') {
    const u = isObj(body.usageMetadata) ? body.usageMetadata : {};
    return { tokens: num(u.totalTokenCount) };
  }
  // openai / local / router are OpenAI-shaped
  const u = isObj(body.usage) ? body.usage : {};
  return { tokens: num(u.total_tokens) || num(u.prompt_tokens) + num(u.completion_tokens) };
}

export class HostRunner {
  private tokens: TokenGovernor;
  private keyResolver: KeyResolver;
  private fetcher: Fetcher;
  private allowEgress: boolean;
  private prices: PriceTable;
  private audit?: AuditLog;
  constructor(deps: RunnerDeps) {
    this.tokens = deps.tokens; this.keyResolver = deps.keyResolver;
    this.fetcher = deps.fetcher ?? ((url, init) => fetch(url, init) as unknown as Promise<HttpResponse>);
    this.allowEgress = deps.allowEgress ?? false;
    this.prices = deps.prices ?? {}; this.audit = deps.audit;
  }

  async run(plan: DispatchPlan): Promise<RunResult> {
    const req: RuntimeRequest = plan.request;

    // 1. Data-egress gate — a hosted router forwards prompts to a third party.
    if (req.kind === 'router' && !this.allowEgress) {
      this.audit?.append({ actor: plan.agentId, domain: 'governance', action: 'egress-blocked', target: req.providerId, decision: 'deny', reason: 'hosted-router data-egress not opted in' });
      throw new GovernanceError(`egress blocked: ${req.providerId} sends data to a third party — operator opt-in required`);
    }

    // 2. Resolve the key from the host keychain and inject into a THROWAWAY header clone.
    const headers: Record<string, string> = { ...req.headers };
    if (req.authScheme !== 'none') {
      const key = await this.keyResolver(req.providerId);
      if (!key) {
        this.audit?.append({ actor: plan.agentId, domain: 'governance', action: 'send-blocked', target: req.providerId, decision: 'deny', reason: 'no API key configured for provider' });
        throw new GovernanceError(`send blocked: no API key for provider ${req.providerId}`);
      }
      if (req.authScheme === 'bearer') headers[req.authHeader ?? 'authorization'] = `Bearer ${key}`;
      else if (req.authScheme === 'x-api-key') headers[req.authHeader ?? 'x-api-key'] = key;
      else if (req.authScheme === 'query') { /* key appended below */ }
    }
    const url = req.authScheme === 'query'
      ? `${req.url}${req.url.includes('?') ? '&' : '?'}${req.authQuery ?? 'key'}=${encodeURIComponent(String(await this.keyResolver(req.providerId) ?? ''))}`
      : req.url;

    // 3. Send. The key lives only in the local `headers`/`url` for this call — never audited or returned.
    const res = await this.fetcher(url, { method: req.method, headers, body: JSON.stringify(req.body) });
    const text = await res.text();
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    // A15: never let unparseable/absent usage silently cost 0 (which would starve the budget). When the
    // provider gives no countable usage, fall back to a conservative char/4 estimate over the request +
    // response so the Token Governor still advances and can trip.
    const reported = parseUsage(req.kind, parsed).tokens;
    const estimated = reported === 0;
    const tokens = estimated ? Math.max(1, Math.ceil((JSON.stringify(req.body).length + text.length) / 4)) : reported;
    const price = this.prices[req.model]?.perMTokUsd ?? 0;
    const usd = (tokens / 1_000_000) * price;

    // 4. Record usage back into the Token Governor (feeds the NEXT route's budget pressure).
    const budget = this.tokens.record(plan.agentId, usd, tokens);
    this.audit?.append({ actor: plan.agentId, domain: 'system', action: 'model-call', target: req.model,
      decision: res.ok ? 'allow' : 'deny',
      reason: `provider=${req.providerId} status=${res.status} tokens=${tokens}${estimated ? '(estimated)' : ''} usd=${usd.toFixed(4)} budget=${budget}` });
    return { ok: res.ok, status: res.status, text, tokens, usd, budget };
  }
}
