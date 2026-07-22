// A COOPERATIVE host skill. It has NO Starfish import — it just routes its one tool call (writing a
// file) through the local governance sidecar over HTTP. This is the "zero-change" wedge: the skill's
// own logic is untouched, and any language that can speak HTTP can use it.
//
// Be exact about what this demonstrates. The sidecar is an ADVISORY policy decision point: `/v1/decide`
// returns a verdict, and THIS SKILL then chooses to honour it. Note line 4 — the skill imports
// `writeFileSync` and holds that handle throughout. Starfish is on the other end of a socket; it can
// answer "no", but it cannot stop a host that ignores the answer. See rogue-skill.mjs, which is this
// file with one line changed, for the proof.
//
// So: governance holds here because the skill cooperates. That is a real and useful property — most
// hosts are yours and you want them governed — but it is not the same as enforcement, and the two
// should never be described in the same words. For enforcement, see host-skill-enforced.ts (Starfish
// performs the IO) or the Claude Code overlay with `--managed` (the seam lives in the agent runtime).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.SF_URL, TOKEN = process.env.SF_TOKEN, ROOT = process.env.SF_ROOT;
const H = { 'content-type': 'application/json', 'x-starfish-wire': '1', authorization: 'Bearer ' + TOKEN };
const target = join(ROOT, 'notes.md');
const content = '1. Fish breathe through gills.\n2. Some fish school for safety.\n3. Fish predate dinosaurs.\n';
const call = { agentId: 'worker', tool: 'fs.write', input: { path: target, content } };
const boundary = { visibility: [ROOT], write: [ROOT] };

console.log('[skill] I want to write ' + target);
const d = await (await fetch(URL + '/v1/decide', { method: 'POST', headers: H, body: JSON.stringify({ call, boundary }) })).json();
console.log('[skill] governance verdict: ' + JSON.stringify(d));
if (d.allow) { writeFileSync(target, content); console.log('[skill] allowed -> wrote the file'); process.exit(0); }
if (!d.ask) { console.log('[skill] denied -> aborting (deny-by-default)'); process.exit(1); }

const { id } = await (await fetch(URL + '/v1/decisions', { method: 'POST', headers: H, body: JSON.stringify({ decision: { kind: 'tool', tool: 'fs.write', target, riskTier: 'medium', reason: 'skill wants to write notes.md', refId: 'demo1' } }) })).json();
console.log('[skill] parked for operator approval (id=' + id + '), waiting...');
let status = 'pending';
for (let i = 0; i < 100 && status === 'pending'; i++) { await new Promise((r) => setTimeout(r, 150)); status = (await (await fetch(URL + '/v1/decisions/' + id, { headers: H })).json()).status; }
console.log('[skill] outcome: ' + status);
if (status === 'approved') { writeFileSync(target, content); console.log('[skill] approved -> wrote ' + target); process.exit(0); }
console.log('[skill] not approved -> did not write'); process.exit(1);
