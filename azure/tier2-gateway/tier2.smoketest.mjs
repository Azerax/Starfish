// Smoke test for gateway.ts. Spins up two real local HTTP servers (a fake upstream MCP backend, a fake
// sidecar implementing just enough of /v1/decide + /v1/decisions to drive the gateway), then drives the
// real gateway.ts logic over real HTTP. Written now; deliberately NOT run until the final consolidated
// test pass at the end of tonight's session (per the "testing moved to the end" instruction) -- see
// IMPLEMENTATION_PLAN.md Sec 6 for that run's results.
//
// What this test does NOT prove: that a real MCP server or a real Foundry-initiated call behaves this
// way. It proves the gateway's own proxy/decide/deny logic is internally correct against a controllable
// stand-in, same honesty scope as server_stub.mjs's relationship to a real Foundry deployment.

import http from 'node:http';
import { createTier2Gateway, classifyMcpToolsCall } from './gateway.ts';

const results = [];
function check(name, cond, detail) { results.push([name, cond, detail]); }

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function jsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      resolve(raw ? JSON.parse(raw) : {});
    });
  });
}

// --- fake upstream: echoes back what it received, so we can confirm the gateway forwarded unchanged ---
const upstream = http.createServer(async (req, res) => {
  const body = await jsonBody(req);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ upstream_received: body, path: req.url }));
});
const upstreamPort = await listen(upstream);

// --- fake sidecar: /v1/decide behavior driven by the tool name so the test can hit allow/deny/ask ---
let filedCount = 0;
const sidecar = http.createServer(async (req, res) => {
  if (req.url === '/v1/decide' && req.method === 'POST') {
    const body = await jsonBody(req);
    const tool = body?.call?.tool;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (tool === 'allowed_tool') res.end(JSON.stringify({ allow: true, ask: false, reason: 'ok' }));
    else if (tool === 'ask_tool') res.end(JSON.stringify({ allow: false, ask: true, reason: 'needs review' }));
    else res.end(JSON.stringify({ allow: false, ask: false, reason: 'not allowlisted' }));
    return;
  }
  if (req.url === '/v1/decisions' && req.method === 'POST') {
    filedCount += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `dec_fake_${filedCount}` }));
    return;
  }
  res.writeHead(404); res.end();
});
const sidecarPort = await listen(sidecar);

const gatewayOpts = {
  upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
  sidecarBaseUrl: `http://127.0.0.1:${sidecarPort}`,
  sidecarToken: 'fake-token',
  agentId: 'gateway-test-agent',
  boundary: { visibility: ['/anything'] },
  protocol: 'mcp',
  classify: classifyMcpToolsCall,
};
const gateway = createTier2Gateway(gatewayOpts);
const gatewayPort = await listen(gateway);
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

async function callGateway(mcpBody) {
  const resp = await fetch(gatewayUrl + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mcpBody),
  });
  return { status: resp.status, body: await resp.json() };
}

// --- allow: forwards to upstream unchanged ---
{
  const { status, body } = await callGateway({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'allowed_tool', arguments: { x: 1 } } });
  check('allow -> HTTP 200 from upstream (proxied)', status === 200, `status=${status}`);
  check('allow -> upstream actually received the forwarded call', body?.upstream_received?.method === 'tools/call' && body?.upstream_received?.params?.name === 'allowed_tool', JSON.stringify(body));
}

// --- deny: blocked before reaching upstream ---
{
  const { status, body } = await callGateway({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'denied_tool', arguments: {} } });
  check('deny -> JSON-RPC error shape, not proxied to upstream', body?.error?.message === 'denied_by_governance', JSON.stringify(body));
  check('deny -> preserves the original JSON-RPC id', body?.id === 2, JSON.stringify(body));
}

// --- ask: degrades to deny, but files a decision for operator visibility first ---
{
  const before = filedCount;
  const { body } = await callGateway({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask_tool', arguments: {} } });
  check('ask -> still denies the request (documented Tier-2 limitation)', body?.error?.message === 'denied_by_governance', JSON.stringify(body));
  check('ask -> files a decision with the sidecar for operator review', filedCount === before + 1, `filedCount ${before} -> ${filedCount}`);
  check('ask -> denial reason references the filed decision id', typeof body?.error?.data?.decisionId === 'string' && body.error.data.decisionId.startsWith('dec_fake_'), JSON.stringify(body?.error?.data));
}

// --- non-tool-call (e.g. tools/list) passes through ungoverned ---
{
  const { status, body } = await callGateway({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });
  check('tools/list (not a tool execution) passes through to upstream ungoverned', status === 200 && body?.upstream_received?.method === 'tools/list', JSON.stringify(body));
}

// --- requireSharedSecret: a second gateway instance, secret enabled, on the SAME upstream+sidecar ---
// (added after a security review found the default config has no caller-side auth at all -- see
// gateway.ts's "gap 1" header comment and IMPLEMENTATION_PLAN.md Sec 6a)
{
  const secretGateway = createTier2Gateway({ ...gatewayOpts, requireSharedSecret: 'test-secret-123' });
  const secretPort = await listen(secretGateway);
  const secretUrl = `http://127.0.0.1:${secretPort}`;

  const noHeaderResp = await fetch(secretUrl + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'allowed_tool', arguments: {} } }),
  });
  check('requireSharedSecret: missing header -> 401, never reaches classify/proxy', noHeaderResp.status === 401, `status=${noHeaderResp.status}`);

  const wrongHeaderResp = await fetch(secretUrl + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-starfish-gateway-secret': 'wrong' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'allowed_tool', arguments: {} } }),
  });
  check('requireSharedSecret: wrong header value -> 401', wrongHeaderResp.status === 401, `status=${wrongHeaderResp.status}`);

  const rightHeaderResp = await fetch(secretUrl + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-starfish-gateway-secret': 'test-secret-123' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'allowed_tool', arguments: {} } }),
  });
  const rightHeaderBody = await rightHeaderResp.json();
  check('requireSharedSecret: correct header value -> normal governed flow proceeds (allow -> proxied)', rightHeaderResp.status === 200 && rightHeaderBody?.upstream_received?.params?.name === 'allowed_tool', JSON.stringify(rightHeaderBody));

  // Found on review (this file's requireSharedSecret path had never been checked against a duplicated
  // header, and separately used a non-constant-time `!==` string comparison -- fixed in gateway.ts to use
  // the same timingSafeEqual-based pattern serve.ts already uses for bearer tokens). Send the header twice
  // via raw http.request (fetch's Headers API can't represent a duplicate header the way a real duplicate
  // wire header would) -- Node comma-joins most headers on receipt, so this either arrives as
  // "test-secret-123, wrong" or similar, never as the exact secret alone.
  {
    const dupResult = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'allowed_tool', arguments: {} } });
      const req = http.request(
        { hostname: '127.0.0.1', port: secretPort, path: '/mcp', method: 'POST',
          headers: { 'content-type': 'application/json', 'x-starfish-gateway-secret': ['test-secret-123', 'wrong'] } },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf-8') }));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
    check(
      'requireSharedSecret: a duplicated header (correct value + a second, garbage value) is rejected, not accepted on a partial/first-value match',
      dupResult.status === 401,
      `status=${dupResult.status} body=${dupResult.raw}`,
    );
  }

  secretGateway.close();
}

gateway.close(); upstream.close(); sidecar.close();

const passed = results.filter(([, ok]) => ok).length;
for (const [name, ok, detail] of results) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`);
console.log(`\n${passed}/${results.length} tier2-gateway checks passed`);
if (passed !== results.length) process.exit(1);
