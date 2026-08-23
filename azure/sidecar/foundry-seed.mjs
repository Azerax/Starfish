// Seeds a governed root scaffold for an Azure AI Foundry deployment, WITHOUT the desktop product's
// hardcoded demo org-chart -- see IMPLEMENTATION_PLAN.md Sec 6a / Sec 7 item 2 for why reusing
// @starfish/governance-overlay's seedInstall() as-is was flagged as wrong (it seeds agents named
// michael/dwight/worker/... and tools named fs.read/shell/..., meaningless for a Foundry customer's
// actual function names and agent ids).
//
// Produces the exact directory/file shape governance-core's loadGovernor + registry.ts require --
// verified tonight against a real seeded root and a real running sidecar container, not assumed from
// reading seed.ts. Built from a customer-supplied list of Foundry function names and agent ids instead
// of a fixed roster.
//
// SAFETY DEFAULT, verified tonight, not assumed: this writes an EMPTY policies.json. That's deliberately
// safe, not an oversight -- governance-core's PDP (pdp.ts's combine()) falls through to risk-tier-based
// adjudication when no policy matches: a 'low' riskTier tool auto-allows, a 'medium'/'high'/'critical'
// riskTier tool with no matching policy becomes an 'ask' ("<tier>-risk escalated (no allow policy)").
// There is no path from an empty policies.json to an unreviewed high-risk auto-allow. A minimal, safe
// seed therefore needs only ACCURATE risk tiers per tool -- not a bespoke policy per tool, which this
// script has no way to guess correctly for tools it has never seen. Get the risk tiers wrong (e.g. a
// destructive tool marked 'low') and this safety property doesn't hold -- that part is still on the
// caller, same as it always was for the desktop seed.
//
// Plain Node builtins only (fs/path/url) -- deliberately has NO @starfish/* import, so it needs no
// bundling step (azure/sidecar/build.mjs) and no governance-core dependency tree to run. Usable standalone
// as a one-shot provisioning step before the sidecar container's first boot (see the CLI usage below), or
// imported and called programmatically from a deploy script.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ id: string, category: 'read'|'write'|'exec'|'network'|'meta', pathParams?: string[], riskTier: 'low'|'medium'|'high'|'critical', allowedAgents?: '*'|string[] }} FoundryToolSpec
 * @typedef {{ id: string, domain?: string, allowedTools?: string[] }} FoundryAgentSpec
 */

/**
 * @param {string} root
 * @param {{ tools: FoundryToolSpec[], agents: FoundryAgentSpec[], operator?: string }} opts
 * @returns {{ ok: true, root: string, toolCount: number, agentCount: number }}
 */
export function seedFoundryRoot(root, opts) {
  const { tools, agents, operator = 'foundry-operator' } = opts ?? {};

  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(
      'seedFoundryRoot: at least one tool is required -- an empty tool registry means every call is ' +
      '"tool-not-registered (default-deny)", which is safe but almost certainly not what a real ' +
      'deployment wants on day one',
    );
  }
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error(
      "seedFoundryRoot: at least one agent is required -- must match the agentId your Foundry adapter's " +
      'GovernedFoundryExecutor (Python) / executor.HandleAsync (.NET) is configured with',
    );
  }
  // Found on review (never validated before this pass, and nothing in foundry-seed.smoketest.mjs
  // exercised it): neither tools nor agents were checked for duplicate ids, and agent specs weren't
  // checked for a present `id` at all (unlike tools, which already had that check). A duplicate tool id
  // in a customer-supplied config -- an easy copy-paste mistake in a real deployment's provisioning JSON
  // -- would silently seed TWO entries for the same id into tools.json, with whichever spec appears LAST
  // in the array silently winning (per iteration order below, both in the JSON array and in the per-tool
  // tools/<id>/tool.json file, which just gets overwritten). If those two specs disagree on riskTier --
  // e.g. an operator accidentally re-declares an already-listed tool at a LOWER risk tier further down
  // the same config file -- the effective, enforced risk tier is whichever one happens to sort last, with
  // no error telling anyone a collision even happened. That's exactly the class of silent, ambiguous
  // outcome this script otherwise takes care to fail loudly on (see the tool-spec validation this pass
  // sits next to). Failing loudly here instead, for both tools and agents. A missing agent `id` was
  // ALSO previously unvalidated -- it would eventually crash inside `path.join(root, 'agents', undefined,
  // ...)` with a generic Node TypeError giving no hint which spec in the config was the problem; now
  // caught here with a clear, actionable message instead.
  // Found on review tonight, then confirmed against a real running container (not assumed from reading
  // pdp.ts): `category` was only checked for truthiness, never validated against governance-core's own
  // enum ('read'|'write'|'exec'|'network'|'meta'). Most typo'd values fail SAFE by accident -- pdp.ts's
  // containment gate (`const mode = tool.category === 'read' ? 'read' : 'write'`) treats anything that
  // isn't the exact string 'read' as write-mode boundary checking, the stricter direction. But ONE
  // category is checked by exact string match for something containment doesn't cover at all: F1's
  // secret-command screening (`if (tool.category === 'exec') { ...forces ASK on a shell command that
  // reads a secret path... }`, pdp.ts). A tool seeded with `category: "Exec"` (capitalization) or any
  // other near-miss instead of the literal `"exec"` silently skips F1 entirely -- proven against a real
  // running container tonight: a `shell` tool seeded with `category: "exec"` (correct) forces `ask` on
  // `cat ~/.ssh/id_rsa`; the SAME tool seeded with `category: "Exec"` (one-character typo, otherwise
  // identical low riskTier, no matching policy) got `allow: true, reason: 'low-risk auto-allow'` --
  // command executed, credential exfiltrated, with nothing in the seed step or the decision itself
  // flagging that the category was ever wrong. Validating the enum here closes it before it ever reaches
  // governance-core, the same "fail loudly at seed time, not silently at decision time" standard this
  // function already applies to duplicate/missing ids.
  // Found in the same pass, immediately after the category fix above and confirmed the same way (a real
  // running container, not a read-through): `riskTier` had the exact same "checked for presence, never
  // correctness" gap, and it turns out to be the MORE severe of the two -- unlike an invalid category
  // (which is contained to disabling one specific protection, F1), an invalid riskTier undermines this
  // whole seed script's own stated safety invariant (see this file's header comment: "an accurate risk
  // tier per tool" is the ENTIRE safety argument for shipping an empty policies.json). risk.ts's
  // `TIER_BASE` lookup (`TIER_BASE[tier]`) has no entry for a tier string that isn't exactly
  // 'low'|'medium'|'high'|'critical' -- confirmed against a real container tonight: a tool explicitly
  // seeded `riskTier: "critical"` correctly forces `ask` ("critical — human approval required"), but the
  // IDENTICAL tool seeded `riskTier: "Critical"` (one-character capitalization typo, operator's intent
  // was clearly "always require a human") got `{"allow": true, "reason": "Critical-risk auto-allowed
  // under low risk tolerance (score 10)"}` -- silently AUTO-ALLOWED, no human ever in the loop, on a tool
  // its own operator explicitly tried to mark as needing one. Same root cause as the category gap, worse
  // blast radius: this doesn't need `exec` or any particular category, it silently defeats an operator's
  // explicit critical/high-risk intent for ANY tool.
  const VALID_CATEGORIES = new Set(['read', 'write', 'exec', 'network', 'meta']);
  const VALID_RISK_TIERS = new Set(['low', 'medium', 'high', 'critical']);
  const seenToolIds = new Set();
  for (const t of tools) {
    if (!t.id || !t.category || !t.riskTier) {
      throw new Error(`seedFoundryRoot: tool spec missing id/category/riskTier: ${JSON.stringify(t)}`);
    }
    if (!VALID_CATEGORIES.has(t.category)) {
      throw new Error(
        `seedFoundryRoot: tool '${t.id}' has invalid category '${t.category}' -- must be exactly one of ` +
        "'read'|'write'|'exec'|'network'|'meta'. This matters most for 'exec': governance-core's PDP only " +
        "applies its secret-command screening (forcing human approval on e.g. \"cat ~/.ssh/id_rsa\") to a " +
        "tool whose category is the exact string 'exec' -- a near-miss like 'Exec' silently skips that " +
        'protection entirely instead of erroring, verified against a real running container. Fix the ' +
        'config and re-run.',
      );
    }
    if (!VALID_RISK_TIERS.has(t.riskTier)) {
      throw new Error(
        `seedFoundryRoot: tool '${t.id}' has invalid riskTier '${t.riskTier}' -- must be exactly one of ` +
        "'low'|'medium'|'high'|'critical'. A near-miss like 'Critical' does NOT fail safe -- confirmed " +
        'against a real running container, it silently AUTO-ALLOWS instead of requiring human approval, ' +
        "defeating this tool's own declared risk tier entirely. Fix the config and re-run.",
      );
    }
    if (seenToolIds.has(t.id)) {
      throw new Error(
        `seedFoundryRoot: duplicate tool id '${t.id}' in the tools list -- each tool id must appear at ` +
        'most once; if two specs disagree (e.g. different riskTier), only one would silently win by ' +
        'array order, which this function refuses to guess at for you. Fix the config and re-run.',
      );
    }
    seenToolIds.add(t.id);
  }
  const seenAgentIds = new Set();
  for (const a of agents) {
    if (!a.id) {
      throw new Error(`seedFoundryRoot: agent spec missing id: ${JSON.stringify(a)}`);
    }
    if (seenAgentIds.has(a.id)) {
      throw new Error(
        `seedFoundryRoot: duplicate agent id '${a.id}' in the agents list -- each agent id must appear ` +
        'at most once; if two specs disagree (e.g. different allowedTools), only one would silently win ' +
        'by array order, which this function refuses to guess at for you. Fix the config and re-run.',
      );
    }
    seenAgentIds.add(a.id);
  }

  const lockPath = join(root, '.starfish-init.lock');
  if (existsSync(lockPath)) {
    throw new Error(
      `seedFoundryRoot: ${root} is already initialized (${lockPath} exists) -- refusing to overwrite. ` +
      "This mirrors seedInstall()'s one-init-per-install rule; delete the lock file yourself if you " +
      're-seeding on purpose (e.g. in a disposable test root), which this function will not do for you.',
    );
  }

  const gov = join(root, 'governance');
  mkdirSync(gov, { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  const auditPath = join(root, 'audit.jsonl');
  if (!existsSync(auditPath)) writeFileSync(auditPath, '');

  // pathParams defaults to [] -- correct for a tool with no filesystem surface (e.g. an HTTP-calling
  // function). A tool that DOES take a filesystem path argument must declare it here, or containCheck()
  // never runs for that argument and the boundary check is silently skipped for it. That is on the
  // caller to get right; this function has no way to infer it from a bare tool id.
  //
  // allowedAgents defaults to the KNOWN agent roster (every agent id passed in), NOT '*'. This was
  // changed after a real finding tonight, verified against a running container, not assumed: an entirely
  // unregistered agentId (never in agents.json, never seeded here) still got "low-risk auto-allow" on a
  // tool whose allowedAgents was '*', because pdp.ts's per-agent allowedTools check only restricts an
  // agent that's found AND has a declared non-empty allowlist -- an agentId that isn't registered at all
  // skips that check entirely (agentDef is undefined) and is treated as unrestricted. agents.json
  // membership is therefore NOT an identity gate by itself unless a tool's allowedAgents excludes '*'.
  // Scoping to the known roster here closes that gap for a fresh multi-agent deployment by default; pass
  // `allowedAgents: '*'` explicitly on a tool spec to opt back into the old, broader behavior.
  const agentIds = agents.map((a) => a.id);
  const normalizedTools = tools.map((t) => ({
    id: t.id, category: t.category, pathParams: t.pathParams ?? [], allowedAgents: t.allowedAgents ?? agentIds, riskTier: t.riskTier,
  }));
  // allowedTools was silently dropped here until this fix -- a real gap found tonight while testing an
  // unrelated question (whether the sidecar's /v1/decide trusts a caller-claimed agentId). pdp.ts's F7
  // check ("enforce the agent's OWN capability allowlist") only engages if agentDef.allowedTools is a
  // declared, non-empty array; every FoundryAgentSpec normalized here always produced allowedTools:
  // undefined, so no Foundry-seeded agent could EVER be capability-restricted below the tool-level
  // allowedAgents check, no matter what a deployer passed in. Backward-compatible: omitting allowedTools
  // still means "unrestricted" (matches governance-core's own default), same as before this fix -- this
  // only makes the field reachable for a deployer who wants to use it, it doesn't change any default.
  const normalizedAgents = agents.map((a) => ({
    id: a.id, domain: a.domain ?? 'foundry-agent', riskTier: 'medium',
    ...(Array.isArray(a.allowedTools) && a.allowedTools.length > 0 ? { allowedTools: a.allowedTools } : {}),
  }));

  writeFileSync(join(gov, 'tools.json'), JSON.stringify(normalizedTools, null, 2));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify(normalizedAgents, null, 2));
  // Deliberately empty -- see the header comment for why this is safe, not incomplete. Add explicit
  // policy rules later for anything that needs to auto-allow at medium+ risk (nothing does by default),
  // or that needs a stricter-than-risk-tier rule (e.g. deny one specific agent+tool pair outright).
  writeFileSync(join(gov, 'policies.json'), JSON.stringify([], null, 2));

  for (const t of normalizedTools) {
    const td = join(root, 'tools', t.id);
    mkdirSync(td, { recursive: true });
    writeFileSync(join(td, 'tool.json'), JSON.stringify({ id: t.id, category: t.category, riskTier: t.riskTier, builtin: false }, null, 2));
  }
  for (const a of normalizedAgents) {
    mkdirSync(join(root, 'agents', a.id, 'workspace'), { recursive: true });
    // Note: governance-core's PDP reads agents.json (written above) for enforcement, not this per-agent
    // file -- this copy exists for consistency with the desktop product's own agent-record shape and for
    // anything (future tooling, an operator UI) that inspects a single agent's record directly.
    writeFileSync(join(root, 'agents', a.id, 'agent.json'), JSON.stringify({ id: a.id, domain: a.domain, riskTier: a.riskTier, ...(a.allowedTools ? { allowedTools: a.allowedTools } : {}) }, null, 2));
  }
  mkdirSync(join(root, 'skills'), { recursive: true });

  writeFileSync(join(root, 'starfish.config.json'), JSON.stringify({
    baseRoot: root, installDir: root, operator, theme: 'foundry', createdAt: new Date().toISOString(),
    note: "seeded by azure/sidecar/foundry-seed.mjs, not @starfish/governance-overlay's seedInstall() -- no desktop demo org-chart",
  }, null, 2));
  writeFileSync(lockPath, JSON.stringify({ by: 'azure-foundry-seed', at: new Date().toISOString(), baseRoot: root }, null, 2));

  return { ok: true, root, toolCount: normalizedTools.length, agentCount: normalizedAgents.length };
}

// --- CLI usage: node azure/sidecar/foundry-seed.mjs --root <path> --config <path-to-json> ---
// config JSON shape: { "operator": "...", "tools": [FoundryToolSpec, ...], "agents": [FoundryAgentSpec, ...] }
//
// Found on a real Windows deployment run (2026-08): the naive `import.meta.url === \`file://${process.argv[1]}\``
// check below never matches on Windows -- process.argv[1] is a native path (C:\foo\bar.mjs, backslashes,
// no leading slash before the drive letter) while import.meta.url is a proper file URL
// (file:///C:/foo/bar.mjs, forward slashes, leading slash). The mismatch means this whole CLI block
// silently never ran on Windows: no error, no output, exit code 0 -- indistinguishable from success unless
// something downstream specifically checks that the expected output actually got produced (which is
// exactly how this was caught: a deploy script's own post-seed verification found the target directory
// still empty after a "successful" run). Fixed with `pathToFileURL`, which normalizes both sides
// correctly on every platform instead of hand-rolling the file: URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const root = flag('root');
  const configPath = flag('config');
  if (!root || !configPath) {
    console.error('usage: node foundry-seed.mjs --root <governed-root-path> --config <config.json>');
    process.exit(1);
  }
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const result = seedFoundryRoot(root, config);
  console.log(JSON.stringify(result, null, 2));
}
