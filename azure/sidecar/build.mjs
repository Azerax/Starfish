// Bundles azure/sidecar/entrypoint.mjs and its full @starfish/* import graph into one self-contained
// file, the same way scripts/bundle-cli.mjs already bundles the CLI (this file mirrors that script's
// approach deliberately, not coincidentally).
//
// WHY THIS EXISTS (found the hard way, not anticipated): running entrypoint.mjs directly via
// `node --experimental-strip-types` -- which is what an earlier draft of this Dockerfile did, and what
// worked fine for serve.ts in isolation during protocol testing (server_stub.mjs) -- does NOT work for
// the real createGovernance() entrypoint. serve.ts's only intra-repo dependency is a TYPE-ONLY import
// (erased at strip time, never resolved at runtime), but index.ts's `createGovernance` pulls in the
// real, full module graph across governance-core/governance-hooks/sdk -- 267 relative imports across
// those three packages at last count, virtually all extensionless (`from './executor'`, not
// `from './executor.ts'`). That's valid under this repo's own tsconfig (`moduleResolution: "bundler"`,
// `noEmit: true` -- it's designed to be consumed by a bundler, never run as raw source), but Node's
// native ESM resolver requires an explicit extension on relative specifiers and has no bundler-style
// fallback. `--experimental-strip-types` only erases type syntax; it does not change module resolution
// rules. Running entrypoint.mjs directly therefore fails with ERR_MODULE_NOT_FOUND on the first
// extensionless import it hits -- discovered by actually building and running the container, not by
// reading the Dockerfile or the source.
//
// Bundling resolves this the same way the CLI already resolves it: esbuild reads real files off disk
// (extensionless imports are its normal case) and emits one flat ESM file with everything inlined,
// which Node can then run with no special flags and no runtime module resolution of its own.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('azure/sidecar/dist', { recursive: true });

await build({
  entryPoints: ['azure/sidecar/entrypoint.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'azure/sidecar/dist/sidecar.mjs',
  logLevel: 'info',
  absWorkingDir: process.cwd(),
});

console.log('bundled sidecar entrypoint -> azure/sidecar/dist/sidecar.mjs');
