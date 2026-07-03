# Govern an existing skill stack in ~10 minutes (Starfish External)

Zero change to your skills' own logic. Your skills route their tool calls through a local governance
sidecar over HTTP; deny-by-default, human approval on risky actions, tamper-evident audit. Loopback-only.

Runnable reference: examples/zero-change-demo/ (`node examples/zero-change-demo/run-demo.mjs`).

> Prerequisite: `embed` / `serve` ship with the Starfish External release (currently on `master`,
> not yet in the published npm `0.11.x`). Until it publishes, run from a source checkout
> (`npm install && npm run build:cli`, then `node packages/cli/dist/cli.mjs <cmd>`).

## 1. Provision governance into your repo (once)
```
npx project-starfish embed init --dir .
```
Seeds a governed root at `./.starfish` (your project is untouched) and writes an embed config.

## 2. Run governance
```
npx project-starfish serve --root ./.starfish
```
Prints the sidecar URL (e.g. http://127.0.0.1:8xxx) and a `sidecar-tokens.json` with a `worker` token
(skills gate with this) and an `operator` token (approvals). Keep it running.

## 3. Gate a tool call from your skill (the only change)
Before your skill performs a file/shell/network action, ask governance. No Starfish import needed:
```js
const H = { 'content-type': 'application/json', 'x-starfish-wire': '1', authorization: `Bearer ${WORKER_TOKEN}` };
const call = { agentId: 'worker', tool: 'fs.write', input: { path: '/abs/path/notes.md', content } };
const boundary = { visibility: [PROJECT_ROOT], write: [PROJECT_ROOT] };
const d = await (await fetch(URL + '/v1/decide', { method: 'POST', headers: H, body: JSON.stringify({ call, boundary }) })).json();
if (d.allow) doTheAction();
else if (d.ask) { /* park for approval, step 4 */ }
else { /* denied: deny-by-default held */ }
```
Tool names use a governed vocabulary (`fs.read`/`fs.write`/`fs.list`/`shell`/`net`). If your host uses
different names, pass them through the pluggable taxonomy (see `@starfish/sdk` `makeTaxonomy`).

## 4. Human approval for risky actions
On `ask`, file the decision and poll its status; an operator approves out of band.
```js
const { id } = await (await fetch(URL + '/v1/decisions', { method: 'POST', headers: H,
  body: JSON.stringify({ decision: { kind: 'tool', tool: 'fs.write', target: '/abs/path/notes.md', riskTier: 'medium', reason: 'writing notes.md', refId: 'x1' } }) })).json();
// poll GET /v1/decisions/{id} -> { status: 'pending' | 'approved' | 'denied' }
```
Operator approves via `POST /v1/decisions/{id}` (operator token) or from a dashboard. proposer != approver
is enforced: a skill cannot approve its own request.

## 5. (Optional) drop-in dashboard
```
npm i @starfish/ui
```
```jsx
import { httpBridge, GovernancePanel } from '@starfish/ui';
<GovernancePanel bridge={httpBridge({ url: URL, tokens: { worker, operator } })} />
```
Renders pending approvals + monitor; drives approve/deny.

## 6. Node hosts: skip HTTP, go in-process (optional)
```
npm i @starfish/sdk
```
```js
import { createGovernance } from '@starfish/sdk';
const sf = createGovernance({ root: './.starfish', keyResolver: () => process.env.ANTHROPIC_API_KEY });
const d = sf.governCall(call, boundary);          // or sf.runGovernedSkill({ ... })
```

## Verify it's healthy
```
npx project-starfish doctor --embed --root ./.starfish
```
Checks schema, audit-chain integrity, safe mode, token permissions, and deny-by-default policy.

## What you get
Deny-by-default enforcement, a hash-chained audit (secrets redacted), per-action human approval, and a
fail-closed loopback service. Your skills' logic is unchanged.
