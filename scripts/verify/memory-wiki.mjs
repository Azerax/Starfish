// Runner for the Memory Wiki end-to-end verification. governance-core publishes TypeScript source
// as its entrypoint (no build step), so the driver is bundled through esbuild first — the same
// approach scripts/bundle-cli.mjs uses.
// Usage: node scripts/verify/memory-wiki.mjs
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outfile = join(mkdtempSync(join(tmpdir(), 'sf-mw-run-')), 'memory-wiki.mjs');

await build({
  entryPoints: [join(ROOT, 'scripts/verify/memory-wiki.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile,
  absWorkingDir: ROOT, logLevel: 'warning',
});

const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
process.exit(r.status ?? 1);
