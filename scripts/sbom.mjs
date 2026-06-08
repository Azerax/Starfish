// SBOM + license check (compliance, R&C D-1). Phase 0.
// Catalogs installed dependencies and fails on copyleft/incompatible licenses.
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COPYLEFT = [/\bGPL\b/i, /AGPL/i, /LGPL/i, /\bMPL\b/i, /\bEPL\b/i, /CDDL/i, /\bOSL\b/i, /EUPL/i, /SSPL/i];
const NM = 'node_modules';

function info(p) {
  try {
    const j = JSON.parse(readFileSync(join(p, 'package.json'), 'utf8'));
    let lic = j.license || (Array.isArray(j.licenses) && j.licenses[0] && j.licenses[0].type) || 'UNKNOWN';
    if (typeof lic === 'object') lic = lic.type || 'UNKNOWN';
    return { name: j.name, version: j.version, license: String(lic) };
  } catch { return null; }
}

const sbom = [], copyleft = [];
function scan(nm) {
  if (!existsSync(nm)) return;
  for (const e of readdirSync(nm)) {
    if (e.startsWith('.')) continue;
    if (e.startsWith('@')) {
      for (const s of readdirSync(join(nm, e))) {
        const i = info(join(nm, e, s));
        if (i) { sbom.push(i); if (COPYLEFT.some(re => re.test(i.license))) copyleft.push(i); }
      }
    } else {
      const i = info(join(nm, e));
      if (i) { sbom.push(i); if (COPYLEFT.some(re => re.test(i.license))) copyleft.push(i); }
    }
  }
}
scan(NM);
writeFileSync('sbom.json', JSON.stringify(sbom, null, 2));
console.log(`SBOM: ${sbom.length} packages catalogued -> sbom.json`);
if (copyleft.length) {
  console.error(`License check FAILED — ${copyleft.length} copyleft/incompatible license(s):`);
  for (const b of copyleft) console.error(`  ${b.name}@${b.version}: ${b.license}`);
  process.exit(1);
}
console.log('License check PASSED — no copyleft/incompatible licenses in the dependency tree.');
