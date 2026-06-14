// Copies generated Fleet portraits (repo art/fleet/*.webp) into the app's served public dir,
// renamed to internal agent ids. Run after `npm run art:fleet`.  Usage: npm run sync:art
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = join(HERE, '..', '..', '..', 'art', 'fleet');
const dst = join(HERE, 'src', 'renderer', 'public', 'portraits');
mkdirSync(dst, { recursive: true });
const MAP = { 'captain-mykel': 'michael', 'first-officer': 'dwight', 'oh-brian-intake': 'toby', 'constable-gooey': 'hank', 'd8a-ops-android': 'pam', 'deck-crew': 'worker' };
let n = 0;
for (const [asset, id] of Object.entries(MAP)) {
  const f = join(src, `${asset}.webp`);
  if (existsSync(f)) { copyFileSync(f, join(dst, `${id}.webp`)); n++; console.log(`  ${id}.webp`); }
}
console.log(`synced ${n} portrait(s) -> ${dst}`);
