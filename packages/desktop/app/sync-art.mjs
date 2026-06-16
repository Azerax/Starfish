// Copies generated Fleet portraits (repo art/fleet/*) into the app's served public dir, renamed to
// internal agent ids. Run after `npm run art:fleet`.  Usage: npm run sync:art
//
// Robust resolution per asset, in order:
//   1. <asset>.webp                      -> copy as <id>.webp
//   2. <asset>.png  (+ ffmpeg on PATH)   -> convert to <id>.webp
//   3. <asset>.png  (no ffmpeg)          -> copy as <id>.png (renderer falls back to it) + warn
//   4. nothing                            -> warn (skipped)
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = join(HERE, '..', '..', '..', 'art', 'fleet');
const dst = join(HERE, 'src', 'renderer', 'public', 'portraits');
mkdirSync(dst, { recursive: true });

const MAP = { 'captain-mykel': 'michael', 'first-officer': 'dwight', 'oh-brian-intake': 'toby', 'constable-gooey': 'hank', 'd8a-ops-android': 'pam', 'quartermaster-custodian': 'custodian', 'deck-crew': 'worker' };

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const FFMPEG = hasFfmpeg();

// Remove any prior copies of an id (either extension) so a new format wins cleanly.
function clearPrior(id) {
  for (const ext of ['webp', 'png']) { const p = join(dst, `${id}.${ext}`); if (existsSync(p)) rmSync(p); }
}

let synced = 0; const skipped = []; const warnings = [];
for (const [asset, id] of Object.entries(MAP)) {
  const webp = join(src, `${asset}.webp`);
  const png = join(src, `${asset}.png`);

  if (existsSync(webp)) {
    clearPrior(id); copyFileSync(webp, join(dst, `${id}.webp`));
    synced++; console.log(`  ${id}.webp`);
  } else if (existsSync(png) && FFMPEG) {
    try {
      clearPrior(id);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', join(dst, `${id}.webp`)]);
      synced++; console.log(`  ${id}.webp  (converted from ${asset}.png)`);
      warnings.push(`${asset}: only a .png existed — converted it. Consider committing art/fleet/${asset}.webp.`);
    } catch (e) {
      clearPrior(id); copyFileSync(png, join(dst, `${id}.png`));
      synced++; console.log(`  ${id}.png   (ffmpeg convert failed; copied PNG)`);
      warnings.push(`${asset}: ffmpeg convert failed (${e.message.split('\n')[0]}); copied raw .png.`);
    }
  } else if (existsSync(png)) {
    clearPrior(id); copyFileSync(png, join(dst, `${id}.png`));
    synced++; console.log(`  ${id}.png   (no ffmpeg; copied PNG)`);
    warnings.push(`${asset}: no .webp and no ffmpeg — copied raw .png (larger). Install ffmpeg or run art:fleet where it's available.`);
  } else {
    skipped.push(asset);
  }
}

console.log(`\nsynced ${synced}/${Object.keys(MAP).length} portrait(s) -> ${dst}`);
for (const w of warnings) console.warn(`  ! ${w}`);
if (skipped.length) {
  console.warn(`  ! SKIPPED (no .webp or .png in art/fleet): ${skipped.join(', ')}`);
  console.warn('    Generate them with:  node art/generate.mjs ' + skipped.join(' '));
}
