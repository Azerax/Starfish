// SBOM + license check (compliance, R&C D-1).
// Catalogs ALL installed dependencies into sbom.json, but ENFORCES the copyleft gate only on
// PRODUCTION deps (you don't ship dev/test tooling) and only on STRONG/network copyleft (GPL/AGPL/
// SSPL/OSL/EUPL). Weak, file-level copyleft (MPL/LGPL/EPL) is allowed and listed for transparency.
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const STRONG_COPYLEFT = [/\bGPL\b/i, /AGPL/i, /\bOSL\b/i, /EUPL/i, /SSPL/i];   // viral; never ship
const WEAK_COPYLEFT = [/\bMPL\b/i, /LGPL/i, /\bEPL\b/i, /CDDL/i];               // file-level; allowed, noted
const NM = 'node_modules';

function info(p) {
  try {
    const j = JSON.parse(readFileSync(join(p, 'package.json'), 'utf8'));
    let lic = j.license || (Array.isArray(j.licenses) && j.licenses[0] && j.licenses[0].type) || 'UNKNOWN';
    if (typeof lic === 'object') lic = lic.type || 'UNKNOWN';
    return { name: j.name, version: j.version, license: String(lic) };
  } catch { return null; }
}

/** Names of production-only deps (the things we actually ship/distribute). null => couldn't compute. */
function prodNames() {
  try {
    const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const names = new Set();
    (function walk(deps) { if (!deps) return; for (const [n, d] of Object.entries(deps)) { names.add(n); walk(d.dependencies); } })(tree.dependencies);
    return names;
  } catch { return null; }   // fail-safe: if we can't tell, fall back to enforcing on everything
}

const sbom = [], strong = [], weak = [];
const prod = prodNames();
const inProd = (name) => prod === null || prod.has(name);
function consider(i) {
  sbom.push(i);
  if (inProd(i.name) && STRONG_COPYLEFT.some((re) => re.test(i.license))) strong.push(i);
  else if (WEAK_COPYLEFT.some((re) => re.test(i.license))) weak.push(i);
}
function scan(nm) {
  if (!existsSync(nm)) return;
  for (const e of readdirSync(nm)) {
    if (e.startsWith('.')) continue;
    if (e.startsWith('@')) { for (const s of readdirSync(join(nm, e))) { const i = info(join(nm, e, s)); if (i) consider(i); } }
    else { const i = info(join(nm, e)); if (i) consider(i); }
  }
}
scan(NM);
writeFileSync('sbom.json', JSON.stringify(sbom, null, 2));
console.log(`SBOM: ${sbom.length} packages catalogued -> sbom.json${prod ? ` (${prod.size} production)` : ' (prod set unknown — enforcing on all)'}`);
if (weak.length) console.log(`  note: ${weak.length} weak-copyleft (MPL/LGPL/EPL) dep(s) present — allowed; e.g. ${weak.slice(0, 3).map((w) => w.name).join(', ')}`);
if (strong.length) {
  console.error(`License check FAILED — ${strong.length} strong-copyleft license(s) in PRODUCTION deps:`);
  for (const b of strong) console.error(`  ${b.name}@${b.version}: ${b.license}`);
  process.exit(1);
}
console.log('License check PASSED — no strong/incompatible copyleft in production dependencies.');
