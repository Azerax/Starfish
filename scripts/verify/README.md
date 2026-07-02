# scripts/verify

One-command gates for the embedding build. Run from the repo root after `npm install`.

- `node scripts/verify/wave0.mjs` (or `pwsh scripts/verify/wave0.ps1` on Windows) runs, in order:
  1. typecheck (whole workspace, includes @starfish/sdk)
  2. dependency-direction lint (sdk may import only core/hooks)
  3. unit + conformance tests (vitest) - includes the Wave 0 SDK suite
  4. CLI bundle (esbuild) sanity
- Exit code 0 = green (Wave 0 done). Non-zero = something failed; the step output is inline above the
  summary. Paste failures back for a fix.

Each later wave adds its own `waveN.mjs` gate; the cross-mode conformance pack (in-process now; sidecar
and overlay later) runs under the test step.
