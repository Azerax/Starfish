// Real entrypoint for the Starfish sidecar container image (Azure deployment). Wires the actual
// @starfish/sdk API (packages/sdk/src/index.ts's createGovernance + serve.ts's startSidecar) -- this is
// NOT the stub used in the local protocol smoke test (see azure/README.md for that distinction).
//
// NOT YET BUILD-TESTED as a container in this session -- doing so requires the full governance-core +
// governance-hooks + sdk dependency tree staged and `npm install`'d, which wasn't done tonight (see
// the implementation plan's "what's verified vs. written" table). The wire-protocol logic this wraps
// WAS verified tonight against the real serve.ts -- what's unverified is specifically the container
// build and the createGovernance() root-provisioning path in a fresh, empty volume.
//
// Deployment shape this assumes (see docs/design/azure.md Sec 3 and the loopback finding in Sec 6 of
// the implementation plan): this container runs as a SIDECAR CONTAINER in the SAME pod / Container Apps
// revision as the customer's own application container. serve.ts binds 127.0.0.1 by design and rejects
// non-loopback callers -- that is intentional, not a bug to work around. Do not expose this container's
// port outside the pod's network namespace.
import { createGovernance, startSidecar } from '@starfish/sdk';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: missing required env var ${name}`); process.exit(1); }
  return v;
}

function parseIdentities() {
  // STARFISH_TOKENS_JSON: '{"worker":"<token>","operator":"<token>"}' -- sourced from Key Vault via a
  // mounted secret / Container Apps secret reference, never baked into the image or a committed file.
  const raw = requireEnv('STARFISH_TOKENS_JSON');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { console.error('FATAL: STARFISH_TOKENS_JSON is not valid JSON'); process.exit(1); }
  const identities = Object.entries(parsed).map(([actor, token]) => ({ actor, token: String(token) }));
  if (identities.length === 0) { console.error('FATAL: STARFISH_TOKENS_JSON has no entries'); process.exit(1); }
  // Reject an empty-string token outright -- serve.ts's own resolveCtx already guards against this
  // specific case (`if (!tok) return null` before the token comparison, confirmed by testing tonight: a
  // request with NO Authorization header at all correctly gets 401, not silently authenticated as
  // whichever identity has an empty token) -- but failing loudly HERE, at boot, catches a misconfigured
  // secret (e.g. a Key Vault reference that resolved to an empty string) before it ships an identity
  // nobody can ever actually use, rather than relying solely on the server's own defense working exactly
  // as expected every time.
  const empty = identities.find((i) => i.token === '');
  if (empty) { console.error(`FATAL: STARFISH_TOKENS_JSON has an empty token for actor '${empty.actor}'`); process.exit(1); }
  // Reject two different actors sharing the same token -- found and verified tonight (IMPLEMENTATION_PLAN.md
  // Sec 6m): startSidecar's resolveCtx does `identities.find(i => tokenEq(i.token, tok))`, which returns
  // the FIRST identity matching a given token -- if two actor names accidentally share one token value
  // (e.g. a copy-paste error wiring up Key Vault secrets), the SECOND actor's token silently authenticates
  // as the FIRST actor instead, with the container booting fine and every request succeeding, just always
  // attributed to the wrong identity in the audit trail. startMultiSidecar (packages/sdk/src/serve.ts)
  // already throws loudly on this exact mistake for its own cross-root case; startSidecar (what this
  // single-root entrypoint actually uses) has no equivalent check, so it's added here instead, at the one
  // place in this deployment that has the full identity list in hand before the sidecar ever starts.
  const seen = new Map();
  for (const i of identities) {
    const prior = seen.get(i.token);
    if (prior) {
      console.error(`FATAL: STARFISH_TOKENS_JSON reuses the same token for both '${prior}' and '${i.actor}' -- ` +
        `these would be indistinguishable to the sidecar ('${i.actor}' would silently authenticate as ` +
        `'${prior}'); give each actor its own unique token`);
      process.exit(1);
    }
    seen.set(i.token, i.actor);
  }
  return identities;
}

function parsePort() {
  // Found on review tonight (same pass that produced the PORT-adjacent parseIdentities() fixes in §6m
  // above): `Number(process.env.PORT ?? 8787)` with no validation has the exact same "silently misconfigure
  // instead of failing loudly" shape §6m fixed for STARFISH_TOKENS_JSON, just for PORT instead of tokens --
  // and it's worse here because Node's http server doesn't even error. Confirmed by direct test tonight:
  // `Number('')` is 0, not NaN, and `http.Server.listen(0, ...)` is a DOCUMENTED Node feature meaning "OS,
  // pick any free port" -- so a PORT env var that's SET but resolves to an empty string (e.g. a Container
  // Apps secret/env reference that resolves empty, a templating bug that drops the value) makes this
  // container boot cleanly, log success, and listen on a random ephemeral port instead of 8787 -- with
  // nothing in the boot log distinguishing that from the intended case. Every adapter and the Bicep
  // template hardcode 127.0.0.1:8787; a silent random-port bind would just make every governed call fail
  // with connection-refused, with no signal pointing back at PORT as the cause. (A non-numeric PORT like
  // "abc" is safer by accident -- Number('abc') is NaN, and Node's http server DOES throw synchronously on
  // that, verified directly -- but an uncaught throw here still isn't the clear `FATAL:` message this
  // file's own STARFISH_TOKENS_JSON checks are careful to produce, so it's validated the same way too.)
  const raw = process.env.PORT;
  if (raw === undefined) return 8787;
  if (raw.trim() === '') { console.error('FATAL: PORT is set but empty -- refusing to fall back to an OS-assigned random port'); process.exit(1); }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`FATAL: PORT='${raw}' is not a valid port number (must be an integer 1-65535)`);
    process.exit(1);
  }
  return n;
}

const root = process.env.STARFISH_ROOT ?? '/data/governed-root';
const port = parsePort();
const identities = parseIdentities();

// keyResolver: the sidecar's decide-only path (Tier 1 gating, the v1 scope) never needs a model
// provider key -- that's only exercised by runGovernedSkill(), which this deployment does not call
// (Foundry's own model call already happened; the adapter only asks Starfish to gate the RESULTING
// tool call). Left as a stub that always returns undefined rather than omitted, so a future Tier-1.5
// feature that DOES need it fails loudly instead of silently.
const keyResolver = () => undefined;

let governance;
try {
  governance = createGovernance({ root, keyResolver });
} catch (e) {
  // Fail-closed: if the governed root is missing/corrupt/on a disallowed filesystem, refuse to start
  // rather than start ungoverned. Matches every other Starfish entrypoint's boot behavior.
  console.error(`FATAL: createGovernance failed (fail-closed, refusing to start ungoverned): ${e.message}`);
  process.exit(1);
}

const sidecar = await startSidecar({ governance, identities, host: '127.0.0.1', port });
console.log(`Starfish sidecar listening on ${sidecar.url} (root=${root})`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`${sig} received, closing sidecar cleanly`);
    await sidecar.close();
    process.exit(0);
  });
}
