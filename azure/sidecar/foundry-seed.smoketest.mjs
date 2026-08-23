// Smoke test for foundry-seed.mjs. Pure filesystem logic, no @starfish/* dependency, so this runs
// standalone with zero setup. Covers what a real container test (IMPLEMENTATION_PLAN.md Sec 6a) can't
// cheaply re-run every time: the scaffold shape itself, the validation guards, and the allowedAgents
// default that was hardened tonight after a real finding (an unregistered agentId got auto-allow on a
// '*'-scoped tool). The actual PDP-level behavior this scaffold produces (auto-allow / ask / deny by risk
// tier) was verified against a real running container tonight -- this test covers the parts of
// foundry-seed.mjs that don't need a container to check: what it writes, and what it refuses to do.
import { seedFoundryRoot } from './foundry-seed.mjs';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const results = [];
function check(name, cond, detail) { results.push([name, cond, detail]); }

function freshDir() { return mkdtempSync(join(tmpdir(), 'foundry-seed-test-')); }

// --- happy path: scaffold shape ---
{
  const dir = freshDir();
  const result = seedFoundryRoot(dir, {
    operator: 'test-op',
    tools: [{ id: 'get_weather', category: 'network', riskTier: 'low' }],
    agents: [{ id: 'agent-a' }],
  });
  check('returns ok:true with correct counts', result.ok === true && result.toolCount === 1 && result.agentCount === 1, JSON.stringify(result));
  check('writes governance/tools.json', existsSync(join(dir, 'governance', 'tools.json')), '');
  check('writes governance/agents.json', existsSync(join(dir, 'governance', 'agents.json')), '');
  check('writes an EMPTY governance/policies.json (safe-by-risk-tier default)', JSON.parse(readFileSync(join(dir, 'governance', 'policies.json'), 'utf8')).length === 0, '');
  check('writes audit.jsonl (empty, for loadGovernor to bootstrap)', existsSync(join(dir, 'audit.jsonl')) && readFileSync(join(dir, 'audit.jsonl'), 'utf8') === '', '');
  check('writes the tool scaffold dir', existsSync(join(dir, 'tools', 'get_weather', 'tool.json')), '');
  check('writes the agent scaffold dir', existsSync(join(dir, 'agents', 'agent-a', 'agent.json')), '');
  check('writes the init lock', existsSync(join(dir, '.starfish-init.lock')), '');
  check('starfish.config.json notes this is NOT the desktop seed', JSON.parse(readFileSync(join(dir, 'starfish.config.json'), 'utf8')).note.includes('no desktop demo org-chart'), '');
  rmSync(dir, { recursive: true, force: true });
}

// --- allowedAgents defaults to the known roster, not '*' (the hardened-tonight behavior) ---
{
  const dir = freshDir();
  seedFoundryRoot(dir, {
    tools: [{ id: 'get_weather', category: 'network', riskTier: 'low' }],
    agents: [{ id: 'agent-a' }, { id: 'agent-b' }],
  });
  const tools = JSON.parse(readFileSync(join(dir, 'governance', 'tools.json'), 'utf8'));
  const allowed = tools[0].allowedAgents;
  check('allowedAgents defaults to the seeded agent roster, not "*"', Array.isArray(allowed) && allowed.length === 2 && allowed.includes('agent-a') && allowed.includes('agent-b'), JSON.stringify(allowed));
  rmSync(dir, { recursive: true, force: true });
}

// --- explicit allowedAgents: '*' opt-out still works ---
{
  const dir = freshDir();
  seedFoundryRoot(dir, {
    tools: [{ id: 'get_weather', category: 'network', riskTier: 'low', allowedAgents: '*' }],
    agents: [{ id: 'agent-a' }],
  });
  const tools = JSON.parse(readFileSync(join(dir, 'governance', 'tools.json'), 'utf8'));
  check('explicit allowedAgents:"*" is preserved when the caller opts in', tools[0].allowedAgents === '*', JSON.stringify(tools[0].allowedAgents));
  rmSync(dir, { recursive: true, force: true });
}

// --- allowedTools passthrough (fixed after a real gap found tonight -- see foundry-seed.mjs's header
// comment near normalizedAgents: this field was silently dropped before this fix, meaning no
// Foundry-seeded agent could ever be capability-restricted below the tool-level allowedAgents check) ---
{
  const dir = freshDir();
  seedFoundryRoot(dir, {
    tools: [{ id: 'fs.read', category: 'read', riskTier: 'low' }, { id: 'fs.write', category: 'write', riskTier: 'medium' }],
    agents: [{ id: 'restricted', allowedTools: ['fs.read'] }, { id: 'unrestricted' }],
  });
  const agents = JSON.parse(readFileSync(join(dir, 'governance', 'agents.json'), 'utf8'));
  const restricted = agents.find((a) => a.id === 'restricted');
  const unrestricted = agents.find((a) => a.id === 'unrestricted');
  check('a declared allowedTools list is written to agents.json', Array.isArray(restricted.allowedTools) && restricted.allowedTools.length === 1 && restricted.allowedTools[0] === 'fs.read', JSON.stringify(restricted));
  check('an agent with no allowedTools stays unrestricted (undefined, not [])', unrestricted.allowedTools === undefined, JSON.stringify(unrestricted));
  check('the per-agent agent.json record also carries allowedTools when declared', JSON.parse(readFileSync(join(dir, 'agents', 'restricted', 'agent.json'), 'utf8')).allowedTools?.[0] === 'fs.read', '');
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses an empty tool list ---
{
  const dir = freshDir();
  let threw = false;
  try { seedFoundryRoot(dir, { tools: [], agents: [{ id: 'a' }] }); } catch { threw = true; }
  check('refuses to seed with zero tools', threw, `threw=${threw}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses an empty agent list ---
{
  const dir = freshDir();
  let threw = false;
  try { seedFoundryRoot(dir, { tools: [{ id: 't', category: 'read', riskTier: 'low' }], agents: [] }); } catch { threw = true; }
  check('refuses to seed with zero agents', threw, `threw=${threw}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses a tool spec missing required fields ---
{
  const dir = freshDir();
  let threw = false;
  try { seedFoundryRoot(dir, { tools: [{ id: 't' }], agents: [{ id: 'a' }] }); } catch { threw = true; }
  check('refuses a tool spec missing category/riskTier', threw, `threw=${threw}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses duplicate tool ids (found on review -- previously unvalidated, would silently
// last-write-wins two DIFFERENT risk tiers for the same id) ---
{
  const dir = freshDir();
  let threw = false;
  let message = '';
  try {
    seedFoundryRoot(dir, {
      tools: [
        { id: 'read_file', category: 'read', riskTier: 'low' },
        { id: 'read_file', category: 'read', riskTier: 'high' }, // accidental re-declaration, different tier
      ],
      agents: [{ id: 'a' }],
    });
  } catch (e) { threw = true; message = String(e.message ?? e); }
  check('refuses a config with a duplicate tool id', threw && message.includes('duplicate tool id'), `threw=${threw} message=${message}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses duplicate agent ids (same reasoning as tool ids) ---
{
  const dir = freshDir();
  let threw = false;
  let message = '';
  try {
    seedFoundryRoot(dir, {
      tools: [{ id: 't', category: 'read', riskTier: 'low' }],
      agents: [{ id: 'worker' }, { id: 'worker', allowedTools: ['t'] }], // accidental re-declaration
    });
  } catch (e) { threw = true; message = String(e.message ?? e); }
  check('refuses a config with a duplicate agent id', threw && message.includes('duplicate agent id'), `threw=${threw} message=${message}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses an agent spec with no id, with a clear message rather than crashing on a bare
// path.join(..., undefined, ...) TypeError deep inside the function ---
{
  const dir = freshDir();
  let threw = false;
  let message = '';
  try {
    seedFoundryRoot(dir, { tools: [{ id: 't', category: 'read', riskTier: 'low' }], agents: [{ domain: 'no-id-here' }] });
  } catch (e) { threw = true; message = String(e.message ?? e); }
  check('refuses an agent spec missing id, with a clear message (not a bare TypeError)', threw && message.includes('agent spec missing id'), `threw=${threw} message=${message}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses an invalid tool category (found + confirmed against a real running container
// tonight -- an "exec"-category typo like "Exec" silently bypassed governance-core's F1 secret-command
// screening; see foundry-seed.mjs's header comment on VALID_CATEGORIES for the full account) ---
{
  const dir = freshDir();
  let threw = false;
  let message = '';
  try {
    seedFoundryRoot(dir, {
      tools: [{ id: 'shell', category: 'Exec', riskTier: 'low' }], // capitalization typo, not the real enum
      agents: [{ id: 'a' }],
    });
  } catch (e) { threw = true; message = String(e.message ?? e); }
  check('refuses a tool with an invalid category', threw && message.includes("invalid category 'Exec'"), `threw=${threw} message=${message}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: every valid category is still accepted (the fix validates against the enum, it doesn't
// accidentally narrow which real categories are allowed) ---
{
  const dir = freshDir();
  let threw = false;
  try {
    seedFoundryRoot(dir, {
      tools: [
        { id: 't_read', category: 'read', riskTier: 'low' },
        { id: 't_write', category: 'write', riskTier: 'medium' },
        { id: 't_exec', category: 'exec', riskTier: 'low' },
        { id: 't_network', category: 'network', riskTier: 'low' },
        { id: 't_meta', category: 'meta', riskTier: 'low' },
      ],
      agents: [{ id: 'a' }],
    });
  } catch { threw = true; }
  check('all five real categories (read/write/exec/network/meta) are still accepted', !threw, `threw=${threw}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses an invalid riskTier (found + confirmed against a real running container tonight,
// immediately after the category fix above -- the more severe of the two: a tool explicitly seeded
// riskTier: "Critical" (typo for "critical") silently AUTO-ALLOWED instead of requiring human approval,
// defeating the operator's own explicit intent for that tool. See foundry-seed.mjs's header comment on
// VALID_RISK_TIERS for the full account) ---
{
  const dir = freshDir();
  let threw = false;
  let message = '';
  try {
    seedFoundryRoot(dir, {
      tools: [{ id: 'danger', category: 'write', riskTier: 'Critical' }], // capitalization typo
      agents: [{ id: 'a' }],
    });
  } catch (e) { threw = true; message = String(e.message ?? e); }
  check('refuses a tool with an invalid riskTier', threw && message.includes("invalid riskTier 'Critical'"), `threw=${threw} message=${message}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: every valid riskTier is still accepted ---
{
  const dir = freshDir();
  let threw = false;
  try {
    seedFoundryRoot(dir, {
      tools: [
        { id: 't_low', category: 'read', riskTier: 'low' },
        { id: 't_medium', category: 'write', riskTier: 'medium' },
        { id: 't_high', category: 'exec', riskTier: 'high' },
        { id: 't_critical', category: 'write', riskTier: 'critical' },
      ],
      agents: [{ id: 'a' }],
    });
  } catch { threw = true; }
  check('all four real risk tiers (low/medium/high/critical) are still accepted', !threw, `threw=${threw}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- guard: refuses to re-seed an already-initialized root ---
{
  const dir = freshDir();
  seedFoundryRoot(dir, { tools: [{ id: 't', category: 'read', riskTier: 'low' }], agents: [{ id: 'a' }] });
  let threw = false;
  try { seedFoundryRoot(dir, { tools: [{ id: 't2', category: 'read', riskTier: 'low' }], agents: [{ id: 'a' }] }); } catch { threw = true; }
  check('refuses to re-seed an already-initialized root (one-init-per-install)', threw, `threw=${threw}`);
  rmSync(dir, { recursive: true, force: true });
}

const passed = results.filter(([, ok]) => ok).length;
for (const [name, ok, detail] of results) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`);
console.log(`\n${passed}/${results.length} foundry-seed checks passed`);
if (passed !== results.length) process.exit(1);
