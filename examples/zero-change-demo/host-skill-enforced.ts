// An ENFORCED host skill — the stronger path, and the one to reach for when a verdict is not enough.
//
// The difference from host-skill.mjs is small to read and large in consequence: this skill never
// imports `node:fs`. It hands a ToolCall to Starfish's executor, and STARFISH performs the write,
// re-checking the boundary and secret-path rules at execution time (the A4 "the PEP re-checks"
// pattern — the decision and the IO act on the same validated value, closing the TOCTOU window).
//
// Be precise about what this does and does not buy you:
//
//   IT DOES  — remove the raw file handle from the skill's own code. A denied call cannot be
//              performed, because the skill has nothing to perform it with. Boundary and secret-path
//              checks are re-applied at the moment of IO, not just at decision time.
//
//   IT DOES NOT — make enforcement non-bypassable. This is a JavaScript host: nothing stops whoever
//              writes it from adding `import { writeFileSync } from 'node:fs'` and going around
//              Starfish entirely. Enforcement here is a property of how the host is CONSTRUCTED,
//              not something imposed on it from outside.
//
// For enforcement that is not the host's to skip, the seam has to live in the agent runtime rather
// than in the skill: the Claude Code overlay with `starfish install --claude-code --managed`, where
// root-owned settings pin the hook and bypass mode is disabled.
//
// That is the whole ladder, stated honestly:
//   sidecar over HTTP   -> advisory     (host holds the handle and chooses to obey)
//   SDK executor (this) -> enforcing by construction (no handle in the skill; host could still add one)
//   overlay --managed   -> not the agent's to skip (enforcement is in the runtime, config is root-owned)
import { makeFsExecutor } from '@starfish/sdk';
import type { BoundarySet, ToolCall } from '@starfish/governance-core';
import { join } from 'node:path';

const URL = process.env.SF_URL!, TOKEN = process.env.SF_TOKEN!, ROOT = process.env.SF_ROOT!;
const H = { 'content-type': 'application/json', 'x-starfish-wire': '1', authorization: 'Bearer ' + TOKEN };
const target = join(ROOT, 'notes-enforced.md');
const content = 'Written by Starfish itself, after an operator approved.\n';
const boundary: BoundarySet = { visibility: [ROOT], write: [ROOT] };
const call: ToolCall = { agentId: 'worker', tool: 'fs.write', input: { path: target, content } };

// Starfish owns the filesystem. This skill has no way to write a file on its own.
const execute = makeFsExecutor({ projectRoot: ROOT, boundary });

console.log('[enforced] I want to write ' + target);
const d = await (await fetch(URL + '/v1/decide', { method: 'POST', headers: H, body: JSON.stringify({ call, boundary }) })).json();
console.log('[enforced] governance verdict: ' + JSON.stringify(d));

if (!d.allow && !d.ask) {
  console.log('[enforced] denied -> aborting. Note I could not write it even if I tried: no fs handle here.');
  process.exit(1);
}

if (d.ask) {
  const { id } = await (await fetch(URL + '/v1/decisions', {
    method: 'POST', headers: H,
    body: JSON.stringify({ decision: { kind: 'tool', tool: 'fs.write', target, riskTier: 'medium', reason: 'enforced skill wants to write notes-enforced.md', refId: 'demo-enforced' } }),
  })).json();
  console.log('[enforced] parked for operator approval (id=' + id + '), waiting...');
  let status = 'pending';
  for (let i = 0; i < 100 && status === 'pending'; i++) {
    await new Promise((r) => setTimeout(r, 150));
    status = (await (await fetch(URL + '/v1/decisions/' + id, { headers: H })).json()).status;
  }
  console.log('[enforced] outcome: ' + status);
  if (status !== 'approved') process.exit(1);
}

// Starfish performs the IO and re-checks the boundary here, at execution time.
const result = await execute(call);
console.log('[enforced] executor result: ' + JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
