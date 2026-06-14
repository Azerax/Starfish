#!/usr/bin/env node
// Fleet art generator — AtlasCloud FLUX.2 Pro. Coherent set via one fixed STYLE + fixed seed.
// Requires ATLASCLOUD_API_KEY (env or .env) and network access to api.atlascloud.ai; optional ffmpeg
// on PATH for webp post-processing. Paces ~60s between requests (the rate window resets on every call).
//   node art/generate.mjs            # all assets
//   node art/generate.mjs captain-mykel bridge-keyart   # a subset
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
function key() {
  if (process.env.ATLASCLOUD_API_KEY) return process.env.ATLASCLOUD_API_KEY;
  const env = join(ROOT, '.env');
  if (existsSync(env)) { const m = readFileSync(env, 'utf8').match(/^ATLASCLOUD_API_KEY=(.+)$/m); if (m) return m[1].trim().replace(/^['"]|['"]$/g, ''); }
  throw new Error('ATLASCLOUD_API_KEY not found (env or .env)');
}
const API = 'https://api.atlascloud.ai/api/v1/model';
const cfg = JSON.parse(readFileSync(join(ROOT, 'art', 'fleet-assets.json'), 'utf8'));
const want = process.argv.slice(2);
const assets = want.length ? cfg.assets.filter((a) => want.includes(a.key)) : cfg.assets;
const RAW = join(ROOT, 'art', 'fleet', '_raw'); const OUT = join(ROOT, 'art', 'fleet');
mkdirSync(RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = key();
const ledger = [];

for (let i = 0; i < assets.length; i++) {
  const a = assets[i];
  if (i > 0) { console.log('>> pacing 60s (rate window)…'); await sleep(60000); }
  const prompt = `${a.lead} ${cfg.style}`;
  console.log(`>> submit ${a.key}`);
  let sub;
  try {
    const r = await fetch(`${API}/generateImage`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, prompt, size: cfg.size, output_format: 'png', seed: cfg.seed }) });
    sub = await r.json();
  } catch (e) { console.log(`   submit error: ${e.message}`); continue; }
  const id = sub?.data?.id || sub?.id; if (!id) { console.log(`   no id: ${JSON.stringify(sub).slice(0,200)}`); continue; }
  let url = '', status = '';
  for (let p = 0; p < 40; p++) {
    await sleep(5000);
    for (const ep of ['prediction', 'result']) {
      try { const pr = await (await fetch(`${API}/${ep}/${id}`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
        status = pr?.data?.status || pr?.status || '';
        if (status === 'completed' || status === 'succeeded') { url = (pr?.data?.outputs || pr?.outputs || [])[0] || ''; break; } } catch { /* retry */ }
    }
    if (url) break;
  }
  if (!url) { console.log(`   no output (${status})`); continue; }
  const png = join(RAW, `${a.key}.png`);
  writeFileSync(png, Buffer.from(await (await fetch(url)).arrayBuffer()));
  let final = `${a.key}.png`;
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', join(OUT, `${a.key}.webp`)]); final = `${a.key}.webp`; }
  catch { writeFileSync(join(OUT, `${a.key}.png`), readFileSync(png)); }
  ledger.push({ asset: final, tool: 'FLUX.2 Pro (AtlasCloud)', prompt, seed: cfg.seed, date: new Date().toISOString() });
  console.log(`   -> ${final}`);
}
writeFileSync(join(OUT, 'provenance.json'), JSON.stringify(ledger, null, 2));
console.log(`>> done. ${ledger.length} asset(s). Provenance: art/fleet/provenance.json`);
