// Secret scan (GA supply-chain gate). Fails the build if a live-looking secret is committed to tracked
// source. Heuristic, deny-on-match: private-key blocks + known provider token shapes. Test files carry
// synthetic fixture keys by design, so *.test.* are skipped; any other file can whitelist a line with a
// trailing `secret-scan:allow` comment. Scans tracked files only (git ls-files).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.env\.example$|\.test\.(ts|tsx|js|mjs)$|\.spec\.(ts|tsx|js|mjs)$|scripts\/secret-scan\.mjs$/;
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|mov)$/i;

const RULES = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/\bsk-ant-[A-Za-z0-9_-]{24,}\b/, 'anthropic secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'google api key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'github token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'slack token'],
];

let files = [];
try { files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean); }
catch { console.error('secret-scan: not a git repo'); process.exit(1); }

const hits = [];
for (const f of files) {
  if (SKIP.test(f) || BINARY.test(f)) continue;
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('secret-scan:allow')) continue;
    for (const [re, label] of RULES) if (re.test(lines[i])) hits.push(`${f}:${i + 1}: possible ${label}`);
  }
}

if (hits.length) {
  console.error('Secret scan FAILED — remove secrets from tracked source and rotate them:');
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`Secret scan PASSED — no committed secrets across ${files.length} tracked files.`);
