// Renderer bundle integrity (F28/F29 defence-in-depth). The desktop IPC bridge exposes privileged
// operations — approve a decision, raise risk tolerance, delete files. Electron IPC has no caller
// authentication, so the main process cannot cryptographically tell "the user clicked approve" from
// "renderer JS called approve". The strongest practical defence is to guarantee the renderer can only
// ever run the code WE shipped: if no attacker code can execute in the renderer, "renderer JS
// self-approves" reduces to "our UI ran an approve on a real user action".
//
// This module is that guarantee's substrate: hash every renderer asset against a manifest captured at
// trust time, and re-verify (a) on load, (b) periodically, and (c) on any filesystem change to the
// renderer directory. A mismatch means the shipped bundle was tampered on disk — the main process then
// enters safe mode and refuses privileged IPC until re-attested.
//
// Pure + testable: no Electron, no globals. The app layer wires the callbacks to BrowserWindow load,
// a timer, and fs.watch. Residual, stated honestly: this defends against a MODIFIED bundle on disk and
// (with CSP + contextIsolation + sandbox + no-remote-content) against injected/remote script; it does
// NOT defend against a live Chromium RCE executing in our exact verified renderer — that needs a
// trusted-path OS confirmation, tracked separately.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export type RendererManifest = Record<string, string>;   // relative posix path -> sha256

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const toPosix = (p: string): string => p.split(sep).join('/');

// Assets whose integrity is load-bearing. Anything executable or that can inject script.
const CODE_EXT = /\.(m?js|cjs|html|css)$/i;

/** Recursively list integrity-relevant files under `dir`, as relative posix paths. */
export function rendererAssets(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && CODE_EXT.test(e)) out.push(toPosix(relative(dir, p)));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** Capture a manifest of the renderer directory at trust time (build/install). */
export function buildRendererManifest(dir: string): RendererManifest {
  const m: RendererManifest = {};
  for (const rel of rendererAssets(dir)) m[rel] = sha256(readFileSync(join(dir, rel)));
  return m;
}

export interface IntegrityResult {
  ok: boolean;
  changed: string[];    // files whose hash differs
  added: string[];      // executable files present now but not in the manifest (injected)
  removed: string[];    // files in the manifest now missing
  reason: string;
}

/** Re-hash the renderer directory and compare against the trusted manifest. Any drift → not ok. */
export function verifyRenderer(dir: string, manifest: RendererManifest): IntegrityResult {
  const now = new Set(rendererAssets(dir));
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [rel, hash] of Object.entries(manifest)) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) { removed.push(rel); continue; }
    if (sha256(readFileSync(abs)) !== hash) changed.push(rel);
  }
  // An executable/injectable file that is NOT in the manifest is an INJECTION — treat as tamper.
  const added = [...now].filter((rel) => !(rel in manifest));
  const ok = changed.length === 0 && added.length === 0 && removed.length === 0;
  const parts: string[] = [];
  if (changed.length) parts.push(`${changed.length} modified`);
  if (added.length) parts.push(`${added.length} injected`);
  if (removed.length) parts.push(`${removed.length} missing`);
  return { ok, changed, added, removed, reason: ok ? 'renderer verified' : `renderer tampered — ${parts.join(', ')}` };
}

export interface RendererWatchDeps {
  dir: string;
  manifest: RendererManifest;
  onTamper: (r: IntegrityResult) => void;   // wire to: enter safe mode + refuse privileged IPC
  periodMs?: number;                          // periodic re-check (default 30s)
  setInterval?: (fn: () => void, ms: number) => { unref?: () => void } & object;
  clearInterval?: (h: unknown) => void;
  watch?: (dir: string, opts: { recursive?: boolean }, cb: () => void) => { close(): void };
}

/**
 * Continuous renderer-integrity guard: verify on start, on every filesystem change, and periodically.
 * Returns a live `ok()` the privileged IPC handlers consult before acting, plus a `stop()`.
 *
 * The three triggers are deliberately redundant (the property you asked for): fs.watch catches an edit
 * immediately, the periodic sweep catches a change fs.watch missed (network mounts, rapid replace), and
 * the on-load check catches a bundle swapped while the app was closed. First failure latches — once
 * tampered, `ok()` stays false until the process restarts and re-verifies clean.
 */
export function guardRenderer(deps: RendererWatchDeps): { ok: () => boolean; verifyNow: () => IntegrityResult; stop: () => void } {
  const period = deps.periodMs ?? 30_000;
  const si = deps.setInterval ?? ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms));
  const ci = deps.clearInterval ?? ((h: unknown) => globalThis.clearInterval(h as never));
  let tampered = false;
  let lastReason = 'not yet verified';

  const check = (): IntegrityResult => {
    const r = verifyRenderer(deps.dir, deps.manifest);
    if (!r.ok && !tampered) { tampered = true; lastReason = r.reason; deps.onTamper(r); }
    return r;
  };

  const first = check();                                    // (a) on load
  const timer = si(() => { check(); }, period);             // (b) periodic
  (timer as { unref?: () => void }).unref?.();
  let watcher: { close(): void } | undefined;
  if (deps.watch) { try { watcher = deps.watch(deps.dir, { recursive: true }, () => { check(); }); } catch { /* watch optional */ } }  // (c) on change

  return {
    ok: () => !tampered && first !== undefined,
    verifyNow: check,
    stop: () => { try { ci(timer); } catch { /* noop */ } try { watcher?.close(); } catch { /* noop */ } lastReason; },
  };
}
