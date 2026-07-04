// Dependency-direction lint (Phase 0; hardened v0.17.0 for audit A19).
// Enforces the ring layering: governance-core < hooks < sdk < overlay < desktop < ui.
// A package may import ONLY packages in strictly LOWER layers.
// v0.17.0: package list AUTO-DERIVED from packages/*/package.json; scans every import form
// (import/export-from, bare side-effect import, dynamic import(), require()) across .ts AND .tsx.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LAYER_ORDER = [
  '@starfish/governance-core',
  '@starfish/governance-hooks',
  '@starfish/sdk',
  '@starfish/governance-overlay',
  '@starfish/desktop',
  '@starfish/ui',
];
const LAYERS = Object.fromEntries(LAYER_ORDER.map((n, i) => [n, i]));

const NAME_BY_DIR = {};
for (const dir of readdirSync('packages')) {
  const pj = join('packages', dir, 'package.json');
  if (!existsSync(pj)) continue;
  const name = JSON.parse(readFileSync(pj, 'utf8')).name;
  if (typeof name === 'string' && name.startsWith('@starfish/')) NAME_BY_DIR[dir] = name;
}

const SKIP = new Set(['node_modules', 'dist', 'out', '.git']);
function walk(dir) {
  let files = [];
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files = files.concat(walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) files.push(p);
  }
  return files;
}

const PATTERNS = [
  /(?:import|export)\b[^'"]*?from\s*['"](@starfish\/[a-z-]+)['"]/g,
  /\bimport\s*['"](@starfish\/[a-z-]+)['"]/g,
  /\bimport\s*\(\s*['"](@starfish\/[a-z-]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"](@starfish\/[a-z-]+)['"]\s*\)/g,
];

const violations = [];
for (const name of Object.values(NAME_BY_DIR)) {
  if (LAYERS[name] === undefined) violations.push(`package ${name} is not placed in LAYER_ORDER — add it to scripts/dep-direction-lint.mjs`);
}
for (const [dir, pkgName] of Object.entries(NAME_BY_DIR)) {
  const myLayer = LAYERS[pkgName];
  if (myLayer === undefined) continue;
  let files = [];
  try { files = walk(join('packages', dir, 'src')); } catch { continue; }
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const seen = new Set();
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const target = m[1];
        if (target === pkgName) continue;
        const tLayer = LAYERS[target];
        if (tLayer === undefined) continue;
        const key = f + '->' + target;
        if (tLayer >= myLayer && !seen.has(key)) {
          seen.add(key);
          violations.push(`${f}: ${pkgName} (layer ${myLayer}) imports ${target} (layer ${tLayer}) — FORBIDDEN (may import strictly lower layers only)`);
        }
      }
    }
  }
}

if (violations.length) {
  console.error('Dependency-direction lint FAILED:');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Dependency-direction lint PASSED — core<hooks<sdk<overlay<desktop<ui holds; governance imports nothing from transports/app.');
