// Bundle the `starfish` CLI into one self-contained file so `project-starfish` installs cleanly from
// BOTH npm and GitHub with zero monorepo resolution at the consumer's end. Inlines every @starfish/*
// package; node builtins stay external. Output: packages/cli/dist/cli.mjs (executable, line-1 shebang).
import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');           // repo root (../ from scripts/)
const entry = join(ROOT, 'packages/governance-overlay/bin/starfish.mjs');
const outfile = join(ROOT, 'packages/cli/dist/cli.mjs');
mkdirSync(join(ROOT, 'packages/cli/dist'), { recursive: true });
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile, logLevel: 'info',
  absWorkingDir: ROOT });
let js = readFileSync(outfile, 'utf8').replace(/^#![^\n]*\n/gm, '');
writeFileSync(outfile, '#!/usr/bin/env node\n' + js);
chmodSync(outfile, 0o755);
console.log('bundled CLI ->', outfile);
