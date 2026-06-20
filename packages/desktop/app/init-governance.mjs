// Dev convenience: seed a governed base root at ./.starfish so the fail-closed boot succeeds in dev.
// This NO LONGER hand-copies the governance arrays — it delegates to the SAME seedInstall() the CLI and
// the desktop wizard use (single source of truth: @starfish/governance-overlay/src/seed.ts), via the
// bundled CLI. Production setup is `starfish init` or the first-run wizard.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));            // packages/desktop/app
const cli = join(here, '..', '..', 'cli', 'dist', 'cli.mjs');   // packages/cli/dist/cli.mjs
if (!existsSync(cli)) {
  console.error('CLI bundle not found. Build it first from the repo root:\n  npm run build:cli\nthen re-run: npm run init:gov');
  process.exit(1);
}
const target = join(process.cwd(), '.starfish');
const r = spawnSync(process.execPath, [cli, 'init', '--dir', target, '--yes', '--no-launch', '--force'], { stdio: 'inherit' });
process.exit(r.status ?? 0);
