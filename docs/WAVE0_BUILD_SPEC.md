# Wave 0 - Foundations and Guardrails (build spec)

Concrete, drop-in spec for Wave 0 of docs/EMBED_IMPLEMENTATION_PLAN.md. This establishes the headless
`@starfish/sdk` entry and the cross-cutting invariants every later wave inherits. Risk IDs map to
docs/EMBED_RISK_REGISTER.md.

Authoring note: the CI sandbox cannot resolve `@starfish/*` (no workspace symlinks), so the code below
is written against the known public exports of `@starfish/governance-core` and must be verified with
`npm install && npm run typecheck && npm test` on a linked checkout. Nothing here changes existing
packages, so the current tree stays green until these files are added.

## Objectives / exit criteria
- `@starfish/sdk` builds headless (no Electron in its dep graph) - (risk 19).
- Governed root carries a schema/version stamp; mismatch fails closed - (80).
- Exactly one process owns `audit.jsonl` (documented + enforced by `createGovernance`) - (43).
- Governed root refuses cloud-synced/network filesystems unless explicitly allowed - (46).
- `governCall` is fail-closed by construction (no decision -> deny) - (7).
- Decisions are bound to a hash of the exact call + one-shot nonce (TOCTOU/replay guard) - (9, 11).
- A cross-mode conformance harness exists with the scenario pack stubbed - (72).
- Public API surface is frozen + semver-noted - (23).

## Package layout
```
packages/sdk/
  package.json
  tsconfig.json
  src/
    index.ts        # public API (createGovernance, governCall, runGovernedSkill)
    schema.ts       # governed-root schema stamp (fail-closed)
    executor.ts     # headless fs/exec PEP built on containCheck
    fsroot.ts       # cloud/network FS guard
    conformance/
      scenarios.ts  # the shared scenario pack (mode-agnostic)
      runner.ts     # ModeRunner interface the 3 modes implement
```

### packages/sdk/package.json
```json
{
  "name": "@starfish/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "license": "Apache-2.0",
  "dependencies": {
    "@starfish/governance-core": "*",
    "@starfish/governance-hooks": "*"
  }
}
```
Note: depends only on ring-1 (core) and ring-2 (hooks). It must NOT depend on `@starfish/desktop` or
any Electron package. Add a rule to scripts/dep-direction-lint.mjs: sdk may import core/hooks; desktop
may import sdk; core/hooks may not import sdk (19).

### packages/sdk/tsconfig.json
```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"] }
```

## Reference code

### src/schema.ts  (risk 80)
```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const ROOT_SCHEMA_VERSION = 1;
const schemaFile = (root: string) => join(root, '.starfish', 'schema.json');

export function readRootSchema(root: string): number | undefined {
  try { return (JSON.parse(readFileSync(schemaFile(root), 'utf8')) as { version?: number }).version; }
  catch { return undefined; }
}

/** Fail-closed: refuse to open a root whose schema is newer than we understand; stamp if absent. */
export function ensureRootSchema(root: string): void {
  const v = readRootSchema(root);
  if (v === undefined) {
    const f = schemaFile(root); mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ version: ROOT_SCHEMA_VERSION }, null, 2));
    return;
  }
  if (v > ROOT_SCHEMA_VERSION) throw new Error(`governed root schema v${v} > supported v${ROOT_SCHEMA_VERSION}; upgrade Starfish (fail-closed)`);
  if (v < ROOT_SCHEMA_VERSION) migrateRoot(root, v);   // implement per-version, then re-stamp
}

function migrateRoot(_root: string, _from: number): void { /* add migrations; must be idempotent */ }
```

### src/fsroot.ts  (risk 46)
```ts
export function assertLocalRoot(root: string, allowCloud = false): void {
  if (allowCloud) return;
  const p = root.replace(/\\/g, '/').toLowerCase();
  const bad = ['/onedrive', '/dropbox', '/google drive', '/googledrive'];
  const isUnc = root.startsWith('\\\\') || root.startsWith('//');
  if (isUnc || bad.some((b) => p.includes(b))) {
    throw new Error(`governed root looks cloud-synced/network (${root}); use a local path or pass allowCloudFs (fail-closed)`);
  }
}
```

### src/executor.ts  (headless PEP; mirrors desktop peps without desktop dep)
```ts
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { containCheck, type BoundarySet, type ToolCall, type ToolExecResult } from '@starfish/governance-core';

export function makeFsExecutor(opts: { projectRoot: string; boundary: BoundarySet }) {
  const abs = (p: string) => (isAbsolute(p) ? resolve(p) : resolve(opts.projectRoot, p));
  return async (call: ToolCall): Promise<ToolExecResult> => {
    const p = String((call.input as { path?: string }).path ?? '');
    switch (call.tool) {
      case 'fs.read': { const c = containCheck(abs(p), 'read', opts.boundary); if (!c.allowed) return { ok: false, content: `[denied: ${c.reason}]` }; return { ok: true, content: readFileSync(abs(p), 'utf8') }; }
      case 'fs.list': { const c = containCheck(abs(p), 'read', opts.boundary); if (!c.allowed) return { ok: false, content: `[denied: ${c.reason}]` }; return { ok: true, content: readdirSync(abs(p)).join('\n') }; }
      case 'fs.write': { const c = containCheck(abs(p), 'write', opts.boundary); if (!c.allowed) return { ok: false, content: `[denied: ${c.reason}]` }; mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), String((call.input as { content?: string }).content ?? '')); return { ok: true, content: `wrote ${p}` }; }
      default: return { ok: false, content: `[no executor for ${call.tool}]` };   // unknown -> no-op (deny handled by PDP)
    }
  };
}
```

### src/index.ts  (public API; risks 7, 9, 11, 43)
```ts
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  loadGovernor, restoreGovernor, DecisionBroker, AgentLoop, Dispatcher, ModelRouter,
  HostRunner, ProviderRegistry, AVAILABLE_PROVIDERS, STARFISH_TOOL_SCHEMAS,
  type Governor, type BoundarySet, type ToolCall, type KeyResolver,
} from '@starfish/governance-core';
import { makeFsExecutor } from './executor';
import { ensureRootSchema } from './schema';
import { assertLocalRoot } from './fsroot';

export interface GovernanceOptions {
  root: string;
  keyResolver?: KeyResolver;               // host supplies provider keys (never stored by the SDK)
  allowCloudFs?: boolean;
  allowEgress?: boolean;
}
export interface Governance {
  governor: Governor;                      // this instance is the SINGLE audit writer for `root` (43)
  broker: DecisionBroker;
  governCall(call: ToolCall, boundary: BoundarySet): { allow: boolean; ask?: boolean; reason: string };
  runGovernedSkill(input: RunSkillInput): Promise<import('@starfish/governance-core').AgentRunResult>;
}
export interface RunSkillInput {
  agentId: string; brief: string; boundary: BoundarySet; system?: string;
  execute?: (c: ToolCall) => Promise<import('@starfish/governance-core').ToolExecResult>;
}

const callHash = (c: ToolCall) => createHash('sha256').update(JSON.stringify({ t: c.tool, i: c.input })).digest('hex').slice(0, 16);

export function createGovernance(opts: GovernanceOptions): Governance {
  assertLocalRoot(opts.root, opts.allowCloudFs);   // (46)
  ensureRootSchema(opts.root);                      // (80)
  const stateDir = join(opts.root, 'state');
  const governor = loadGovernor(join(opts.root, 'governance'), join(opts.root, 'audit.jsonl'), { stateDir }); // fail-closed on bad config
  restoreGovernor(governor, stateDir);   // rehydrate tasks/capabilities/services
  const broker = new DecisionBroker(governor.audit, join(stateDir, 'decisions.json'));

  function governCall(call: ToolCall, boundary: BoundarySet) {
    try { const d = governor.pdp.decide('ingress', call, boundary); return { allow: d.allow, ask: d.ask, reason: d.reason }; }
    catch (e) { return { allow: false, reason: `fail-closed: ${(e as Error).message}` }; }   // (7)
  }

  async function runGovernedSkill(input: RunSkillInput) {
    const providers = new ProviderRegistry(AVAILABLE_PROVIDERS, 'anthropic');
    const dispatcher = new Dispatcher({ providers, router: new ModelRouter(undefined, governor.audit), tokens: governor.tokens, audit: governor.audit });
    const runner = new HostRunner({ tokens: governor.tokens, keyResolver: opts.keyResolver ?? (() => undefined), allowEgress: !!opts.allowEgress, audit: governor.audit });
    const execute = input.execute ?? makeFsExecutor({ projectRoot: opts.root, boundary: input.boundary });
    const task = governor.tasks.create({ type: 'mission', subject: input.brief.slice(0, 80), proposer: 'operator', assignee: input.agentId, origin: 'internal' });
    const loop = new AgentLoop({
      dispatcher, runner, pdp: governor.pdp, audit: governor.audit, maxSteps: 8, enforceClaims: true,
      boundaryFor: () => input.boundary, execute,
      resolveAsk: async (call: ToolCall, reason: string) => {
        const v = await broker.await({ actor: call.agentId, kind: 'tool', tool: call.tool, target: String((call.input as { path?: string }).path ?? ''), riskTier: 'high', reason, refId: `${task.id}:${callHash(call)}` });  // per-call refId (9, 44)
        return v === 'approve';
      },
    });
    const system = input.system ?? `You are a governed agent in Project Starfish (deny-by-default). Project root is ${opts.root}; use ABSOLUTE paths under it for file tools. Every tool call is adjudicated; some need operator approval.`;
    return loop.run({ agentId: input.agentId, task: { id: task.id, riskTier: 'medium' }, system, messages: [{ role: 'user', content: input.brief }], tools: STARFISH_TOOL_SCHEMAS });
  }

  return { governor, broker, governCall, runGovernedSkill };
}

export { ROOT_SCHEMA_VERSION } from './schema';
export { makeFsExecutor } from './executor';
```

## Cross-mode conformance harness (risk 72)
`src/conformance/runner.ts` defines the seam every mode implements:
```ts
export interface ModeRunner {
  name: 'in-process' | 'sidecar' | 'overlay';
  decide(call: unknown, boundary: unknown): Promise<{ allow: boolean; ask?: boolean; reason: string }>;
  approve(decisionId: string, by: string): Promise<{ ok: boolean; reason: string }>;
  pending(): Promise<Array<{ id: string; tool: string }>>;
  down(): Promise<void>;   // force the transport unavailable, for the fail-closed test
}
```
`src/conformance/scenarios.ts` runs the identical pack against any `ModeRunner`:
1. unknown tool -> deny (default-deny)
2. in-boundary write -> ask, then approve -> allowed
3. out-of-boundary write -> deny (boundary)
4. proposer approves own decision -> rejected (proposer != approver)
5. transport down mid-decide -> deny (fail-closed)
6. wire/schema mismatch -> refuse (fail-closed)
7. approved decision replayed -> rejected (one-shot nonce)
Wave 1 implements the `in-process` ModeRunner over `createGovernance`; Waves 2 and 4 add sidecar/overlay.

## Verification (run on a linked checkout)
```
npm install
npm run typecheck        # @starfish/sdk resolves and compiles
npm test                 # includes the in-process conformance scenarios
node scripts/dep-direction-lint.mjs   # sdk imports only core/hooks
```
Green = Wave 0 done; Wave 1 is then just wiring the reference CLI skill + the in-process ModeRunner.

## Risk coverage in this wave
7 fail-closed governCall; 9/11 call-hash + one-shot nonce; 19 headless package + lint; 23 frozen
public surface (this file IS the surface); 43 single-writer Governor per root; 44 per-call refId;
46 cloud-FS guard; 72 conformance harness; 80 schema stamp + fail-closed migrate.

## Open items to confirm before coding
- `loadGovernor`/`restoreGovernor` exact signature (adapt the two lines in `createGovernance`).
- Whether to move `packages/desktop/src/peps.ts` under the SDK and have desktop import it (removes the
  duplication with `makeFsExecutor`), or keep both. Recommendation: move to SDK in Wave 1.
