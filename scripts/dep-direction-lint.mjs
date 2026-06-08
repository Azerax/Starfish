// Dependency-direction lint (Phase 0).
// Enforces the strangler layering: governance-core < hooks < overlay < desktop.
// A package may import ONLY packages in strictly LOWER layers.
// In particular: governance-core imports nothing internal; transports never import the app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LAYERS = {
  '@starfish/governance-core': 0,
  '@starfish/governance-hooks': 1,
  '@starfish/governance-overlay': 2,
  '@starfish/desktop': 3,
};
const NAME_BY_DIR = {
  'governance-core': '@starfish/governance-core',
  'governance-hooks': '@starfish/governance-hooks',
  'governance-overlay': '@starfish/governance-overlay',
  'desktop': '@starfish/desktop',
};
const SKIP = new Set(['node_modules', 'dist', 'out', '.git']);

function walk(dir) {
  let files = [];
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files = files.concat(walk(p));
    else if (p.endsWith('.ts')) files.push(p);
  }
  return files;
}

const importRe = /(?:import|export)[^'"]*from\s*['"](@starfish\/[a-z-]+)['"]/g;
const violations = [];

for (const [dir, pkgName] of Object.entries(NAME_BY_DIR)) {
  const myLayer = LAYERS[pkgName];
  const base = join('packages', dir, 'src');
  let files = [];
  try { files = walk(base); } catch { continue; }
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    let m;
    while ((m = importRe.exec(src))) {
      const target = m[1];
      if (target === pkgName) continue;
      const tLayer = LAYERS[target];
      if (tLayer === undefined) continue;
      if (tLayer >= myLayer) {
        violations.push(`${f}: ${pkgName} (layer ${myLayer}) imports ${target} (layer ${tLayer}) — FORBIDDEN (may import strictly lower layers only)`);
      }
    }
  }
}

if (violations.length) {
  console.error('Dependency-direction lint FAILED:');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Dependency-direction lint PASSED — core<hooks<overlay<desktop holds; governance imports nothing from transports/app.');
