// Governed dispatch — the seam between "a task is ready to run" and "an LLM runs it".
// It binds four governed pieces deterministically:
//   1. TokenGovernor  -> budget pressure (and a hard pause = fail-closed, no run).
//   2. ModelRouter    -> which provider/model executes this task (audited, never affects the PDP).
//   3. ProviderRegistry / AdapterRegistry -> a fully-formed HTTP request, MINUS the secret.
// The host then injects the API key from the OS keychain and performs the call. The dispatcher
// never sees a key, never touches the PDP/vetting/boundary, and is fully deterministic.
import { GovernanceError, type RiskTier } from './types';
import type { AuditLog } from './audit';
import { ModelRouter, type ModelRouteResult, type BudgetState } from './router';
import { ProviderRegistry, AdapterRegistry, type Provider, type ChatTurn, type RuntimeRequest, type ToolSchema } from './provider';
import type { TokenGovernor } from './tokens';

export interface DispatchTask { id: string; riskTier?: RiskTier; taskType?: string; tags?: string[]; }
export interface DispatchInput { agentId: string; task: DispatchTask; system?: string; messages: ChatTurn[]; tools?: ToolSchema[]; }
export interface DispatchPlan {
  taskId: string; agentId: string; budget: BudgetState;
  route: ModelRouteResult; provider: Provider; request: RuntimeRequest;
}

export interface DispatcherDeps {
  providers: ProviderRegistry;
  router: ModelRouter;
  tokens: TokenGovernor;
  adapters?: AdapterRegistry;
  audit?: AuditLog;
}

export class Dispatcher {
  private providers: ProviderRegistry;
  private router: ModelRouter;
  private tokens: TokenGovernor;
  private adapters: AdapterRegistry;
  private audit?: AuditLog;
  constructor(deps: DispatcherDeps) {
    this.providers = deps.providers; this.router = deps.router; this.tokens = deps.tokens;
    this.adapters = deps.adapters ?? new AdapterRegistry(); this.audit = deps.audit;
  }

  /** Plan (but do not send) a model call for a task. Throws if the agent is paused on a hard budget. */
  plan(input: DispatchInput): DispatchPlan {
    const { agentId, task } = input;
    const budget = this.tokens.status(agentId) as BudgetState;
    if (budget === 'hard') {
      this.audit?.append({ actor: agentId, domain: 'governance', action: 'dispatch-blocked', target: task.id, decision: 'deny', reason: 'budget hard — agent paused; human resume required' });
      throw new GovernanceError(`dispatch blocked: ${agentId} is at hard budget (paused) — human resume required`);
    }

    // Route to a worker model (audited inside the router). Budget pressure can downshift; high/critical never do.
    const route = this.router.select({ riskTier: task.riskTier, taskType: task.taskType, tags: task.tags, budget });

    // Resolve the provider. If the routed provider isn't configured/registered:
    //  - high/critical tasks FAIL CLOSED (audit A14): substituting the active provider could silently
    //    downgrade a "this tier must run on provider X" intent, so we refuse rather than misroute.
    //  - low/medium tasks fall back to the active provider (still audited) so a one-provider setup runs.
    let provider: Provider;
    if (this.providers.has(route.providerId)) {
      provider = this.providers.get(route.providerId);
    } else if (task.riskTier === 'high' || task.riskTier === 'critical') {
      this.audit?.append({ actor: 'router', domain: 'governance', action: 'route-provider-unavailable', target: route.providerId, decision: 'deny', riskTier: task.riskTier, reason: `routed provider '${route.providerId}' not registered for ${task.riskTier}-risk task — failing closed (no provider substitution/downshift)` });
      throw new GovernanceError(`dispatch blocked: routed provider '${route.providerId}' unavailable for ${task.riskTier}-risk task — refusing to substitute (fail closed)`);
    } else {
      provider = this.providers.active();
      this.audit?.append({ actor: 'router', domain: 'system', action: 'route-provider-substituted', target: provider.id, reason: `routed provider '${route.providerId}' not registered; using active '${provider.id}'` });
    }

    const adapter = this.adapters.for(provider.kind);
    const request = adapter.buildRequest({ provider, model: route.model, system: input.system, messages: input.messages, tools: input.tools });
    this.audit?.append({ actor: agentId, domain: 'system', action: 'dispatch-planned', target: task.id, reason: `provider=${provider.id} model=${route.model} rule=${route.ruleId} budget=${budget}` });
    return { taskId: task.id, agentId, budget, route, provider, request };
  }
}
