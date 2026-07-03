// @starfish/sdk - headless embedding surface for Starfish External. Composes the governance-core engine
// for in-process use by a host. No @starfish/desktop or Electron dependency. Deny-by-default and
// fail-closed by construction.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  loadGovernor, restoreGovernor, DecisionBroker, AgentLoop, Dispatcher, ModelRouter,
  HostRunner, ProviderRegistry, AVAILABLE_PROVIDERS, STARFISH_TOOL_SCHEMAS,
  type Governor, type BoundarySet, type ToolCall, type KeyResolver, type Fetcher,
  type ToolExecResult, type AgentRunResult,
} from '@starfish/governance-core';
import { makeFsExecutor } from './executor';
import { ensureRootSchema } from './schema';
import { assertLocalRoot, assertSafeRoot } from './fsroot';

export interface GovernanceOptions {
  root: string;                 // governed root (contains governance/, audit.jsonl, state/)
  keyResolver?: KeyResolver;    // host supplies provider keys; the SDK never stores them
  allowCloudFs?: boolean;       // opt out of the cloud/network-FS guard
  allowEgress?: boolean;        // opt in to hosted-router data egress
  fetcher?: Fetcher;            // inject transport (tests / custom clients)
}
export interface GovernDecision { allow: boolean; ask: boolean; reason: string }
export interface RunSkillInput {
  agentId: string;
  brief: string;
  boundary: BoundarySet;
  system?: string;
  execute?: (c: ToolCall) => Promise<ToolExecResult>;
}
export interface Governance {
  governor: Governor;           // this instance is the single audit writer for `root`
  broker: DecisionBroker;
  governCall(call: ToolCall, boundary: BoundarySet): GovernDecision;
  runGovernedSkill(input: RunSkillInput): Promise<AgentRunResult>;
}

const callHash = (c: ToolCall): string =>
  createHash('sha256').update(JSON.stringify({ t: c.tool, i: c.input })).digest('hex').slice(0, 16);

export function createGovernance(opts: GovernanceOptions): Governance {
  assertLocalRoot(opts.root, opts.allowCloudFs);                        // risk 46
  assertSafeRoot(opts.root);                                            // risk 15
  ensureRootSchema(opts.root);                                          // risk 80
  const stateDir = join(opts.root, 'state');
  const governor = loadGovernor(join(opts.root, 'governance'), join(opts.root, 'audit.jsonl'), { stateDir }); // fail-closed on bad config
  restoreGovernor(governor, stateDir);
  const broker = new DecisionBroker(governor.audit, join(stateDir, 'decisions.json'));

  function governCall(call: ToolCall, boundary: BoundarySet): GovernDecision {
    try {
      const d = governor.pdp.decide('ingress', call, boundary);
      return { allow: !!d.allow, ask: !!d.ask, reason: d.reason };
    } catch (e) {
      return { allow: false, ask: false, reason: `fail-closed: ${(e as Error).message}` };   // risk 7
    }
  }

  async function runGovernedSkill(input: RunSkillInput): Promise<AgentRunResult> {
    const providers = new ProviderRegistry(AVAILABLE_PROVIDERS, 'anthropic');
    const dispatcher = new Dispatcher({ providers, router: new ModelRouter(undefined, governor.audit), tokens: governor.tokens, audit: governor.audit });
    const runner = new HostRunner({ tokens: governor.tokens, keyResolver: opts.keyResolver ?? ((_id: string) => undefined), allowEgress: !!opts.allowEgress, audit: governor.audit, fetcher: opts.fetcher });
    const execute = input.execute ?? makeFsExecutor({ projectRoot: opts.root, boundary: input.boundary });
    const task = governor.tasks.create({ type: 'mission', subject: input.brief.slice(0, 80), proposer: 'operator', assignee: input.agentId, origin: 'internal' });
    const loop = new AgentLoop({
      dispatcher, runner, pdp: governor.pdp, audit: governor.audit, maxSteps: 8, enforceClaims: false,
      boundaryFor: () => input.boundary,
      execute,
      resolveAsk: async (call: ToolCall, reason: string) => {
        const v = await broker.await({ actor: call.agentId, kind: 'tool', tool: call.tool, target: String((call.input as { path?: string }).path ?? ''), riskTier: 'high', reason, refId: `${task.id}:${callHash(call)}` });   // per-call refId: risks 9, 44
        return v === 'approve';
      },
    });
    const system = input.system ?? `You are a governed agent in Project Starfish (deny-by-default). The project root is ${opts.root}; use ABSOLUTE paths under it for file tools. Every tool call is adjudicated and some need operator approval.`;
    return loop.run({ agentId: input.agentId, task: { id: task.id, riskTier: 'medium' }, system, messages: [{ role: 'user', content: input.brief }], tools: STARFISH_TOOL_SCHEMAS });
  }

  return { governor, broker, governCall, runGovernedSkill };
}

export { ROOT_SCHEMA_VERSION, readRootSchema, ensureRootSchema } from './schema';
export { assertLocalRoot, assertSafeRoot } from './fsroot';
export { makeInProcessRunner } from './conformance/inprocess';
export { runScenarioPack, type ScenarioEnv, type ScenarioResult } from './conformance/scenarios';
export type { RunnerDecision, RunnerPending } from './conformance/runner';
export { startSidecar, WIRE_VERSION, type Sidecar, type SidecarIdentity, type SidecarOptions } from './serve';
export { makeSidecarRunner, type SidecarClientOptions } from './client';
export { makeTaxonomy, DEFAULT_TAXONOMY, type ToolTaxonomy, type TaxonomyRule } from './taxonomy';
export { makeOverlayRunner, withGovernance, type HostCall, type HostExecResult } from './overlayRunner';
export { makeFsExecutor } from './executor';
export type { ModeRunner } from './conformance/runner';
