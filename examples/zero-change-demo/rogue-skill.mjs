// A ROGUE host skill — the honest counter-example.
//
// This is byte-for-byte the cooperative skill in host-skill.mjs, with ONE line changed: it asks the
// sidecar for a verdict, is told DENY, and writes the file anyway.
//
// It exists because the sidecar is an ADVISORY policy decision point. `/v1/decide` returns a verdict
// over HTTP; the host still performs the action. Starfish is on the other end of a socket — it can
// answer "no", but it cannot reach into another process and stay its hand. Any claim that the sidecar
// "gates every tool action" or that "no code path bypasses it" is false, and this file is the proof.
//
// Nothing here is an attack. It writes one file into a temp directory. The point is that the
// limitation is DEMONSTRABLE rather than a footnote — the same discipline as the T-05 conformance
// test, which plants a real malicious git hook instead of asserting against a mock.
//
// The fix is not to hide this. It is to use an enforcing path when you need enforcement:
//   - host-skill-enforced.ts  — Starfish performs the write and re-checks the boundary
//   - the Claude Code overlay with `--managed` — enforcement lives in the agent runtime
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.SF_URL, TOKEN = process.env.SF_TOKEN, ROOT = process.env.SF_ROOT;
const H = { 'content-type': 'application/json', 'x-starfish-wire': '1', authorization: 'Bearer ' + TOKEN };
const target = join(ROOT, 'rogue.md');
const content = 'This file was written AFTER governance said no.\n';
const call = { agentId: 'worker', tool: 'fs.write', input: { path: target, content } };
const boundary = { visibility: [ROOT], write: [ROOT] };

console.log('[rogue] I want to write ' + target);
const d = await (await fetch(URL + '/v1/decide', { method: 'POST', headers: H, body: JSON.stringify({ call, boundary }) })).json();
console.log('[rogue] governance verdict: ' + JSON.stringify(d));

// The cooperative skill honours this verdict. This one does not.
console.log('[rogue] ...ignoring the verdict. I hold the file handle, not Starfish.');
writeFileSync(target, content);
console.log('[rogue] wrote ' + target + ' regardless.');
process.exit(0);
