// IP denylist scan (compliance, R&C L-1/L-1a/L-3). Phase 0.
// Scans SHIPPABLE source (packages/) for trademarked IP tokens.
// Scope excludes legal NOTICE/LICENSE and planning docs (upstream attribution is required there).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TOKENS = ['LCARS', 'Starfleet', 'U.S.S.', 'NCC-', 'Vulcan', 'Spock', 'Spokk',
  'Odo', "O'Brien", 'Munder', 'Difflin', 'Dunder', 'Mifflin'];
// `azure` added 2026-08-20. The Azure/Foundry tree is at least as shippable as packages/ — it is the
// Marketplace listing and the container image customers actually run — but sat outside every CI gate,
// so a trademarked token in the listing copy or a sidecar string would have shipped unchallenged.
// Same omission shape as adversarial findings F-7/F-8/F-10: real code that no gate touches.
const ROOTS = ['packages', 'azure'];
const SKIP = new Set(['node_modules', 'dist', 'out', '.git']);
const BIN = /\.(png|jpe?g|gif|ico|icns|woff2?|ttf|webp|mp4|zip)$/i;
const TEST = /\.(test|conformance\.test)\.[tj]sx?$/i;  // tests are not shipped — don't scan them

function walk(dir) {
  let f = [];
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) f = f.concat(walk(p));
    else f.push(p);
  }
  return f;
}

const hits = [];
for (const r of ROOTS) {
  let files = [];
  try { files = walk(r); } catch { continue; }
  for (const f of files) {
    if (BIN.test(f) || TEST.test(f)) continue;
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    src.split('\n').forEach((ln, i) => {
      for (const t of TOKENS) if (ln.includes(t)) hits.push(`${f}:${i + 1}: '${t}'`);
    });
  }
}

if (hits.length) {
  console.error(`IP denylist scan FAILED (${hits.length} hit(s)):`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`IP denylist scan PASSED — 0 forbidden IP tokens in shippable source (scanned: ${ROOTS.join(', ')}).`);
