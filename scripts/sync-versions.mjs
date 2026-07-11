// Single-source version sync. The ROOT package.json version is the canonical release number; this
// propagates it to every workspace package's `version` and to any internal `@starfish/*` dependency
// ranges, so `npm run <script>` banners and all manifests always show the real shipped version.
//
// Release flow:  bump root "version"  →  `npm run version:sync`  →  commit  →  tag.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkgPath = join(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
const version = rootPkg.version;

if (!/^\d+\.\d+\.\d+([-.].+)?$/.test(version)) {
  console.error(`[version:sync] root version is not a valid semver: "${version}" — aborting.`);
  process.exit(1);
}

const pkgsDir = join(root, 'packages');
const names = existsSync(pkgsDir) ? readdirSync(pkgsDir) : [];
const total = names.length;
console.log(`[version:sync] target version ${version} · ${total} workspace package(s)`);

let changed = 0;
let step = 0;
for (const name of names) {
  step++;
  const p = join(pkgsDir, name, 'package.json');
  if (!existsSync(p)) continue;
  const pkg = JSON.parse(readFileSync(p, 'utf8'));
  let touched = false;

  if (pkg.version !== version) { pkg.version = version; touched = true; }

  // keep internal @starfish/* dependency ranges in lockstep (skip "*" / "workspace:*" wildcards)
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith('@starfish/')) {
        const cur = deps[dep];
        if (cur !== '*' && !String(cur).startsWith('workspace:') && cur !== `^${version}`) {
          deps[dep] = `^${version}`;
          touched = true;
        }
      }
    }
  }

  if (touched) {
    writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    changed++;
    console.log(`  [${step}/${total}] ${pkg.name} -> ${version}`);
  } else {
    console.log(`  [${step}/${total}] ${pkg.name} already ${version}`);
  }
}

console.log(changed ? `[version:sync] done — updated ${changed} package(s) to ${version}.` : `[version:sync] done — all packages already at ${version}.`);
