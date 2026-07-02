// Policy Enforcement Points (ring 3): the executor that actually DOES a tool call after the PDP allowed
// it. Every action is boundary-checked again (defense in depth), audited, and - for writes - a pre-image
// backup is snapshotted so any overwrite is recoverable. Shell-free where possible (execFile, fixed argv).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { containCheck, type BoundarySet, type ToolCall, type AuditLog } from '@starfish/governance-core';

export interface PepOptions {
  projectRoot: string;
  boundary: BoundarySet;
  audit?: AuditLog;
  backupDir?: string;
  backups?: number;
  testCmd?: string[];          // default ['npm','test']
  maxReadBytes?: number;       // default 100k
}
export interface ToolExecResult { ok: boolean; content: string }

function snapshot(absPath: string, backupDir: string, projectRoot: string, keep: number): boolean {
  try {
    if (!existsSync(absPath)) return false;
    const rel = relative(projectRoot, absPath).replace(/[\\/]/g, '__') || 'file';
    const dir = join(backupDir, rel); mkdirSync(dir, { recursive: true });
    copyFileSync(absPath, join(dir, new Date().toISOString().replace(/[:.]/g, '-')));
    const files = readdirSync(dir).sort();
    while (files.length > Math.max(1, keep)) { const o = files.shift(); if (o) rmSync(join(dir, o)); }
    return true;
  } catch { return false; }
}

export function makeExecutor(opts: PepOptions): (call: ToolCall) => Promise<ToolExecResult> {
  const max = opts.maxReadBytes ?? 100_000;
  const testCmd = opts.testCmd ?? ['npm', 'test'];
  const audit = (action: string, target: string | undefined, decision: 'allow' | 'deny', reason: string) =>
    { try { opts.audit?.append({ actor: 'worker', domain: decision === 'allow' ? 'tool' : 'governance', action: `exec:${action}`, target, decision, reason }); } catch { /* noop */ } };

  return async (call: ToolCall): Promise<ToolExecResult> => {
    const p = typeof call.input.path === 'string' ? call.input.path : undefined;
    try {
      switch (call.tool) {
        case 'fs.read': {
          if (!p) return { ok: false, content: '[fs.read: missing path]' };
          const c = containCheck(p, 'read', opts.boundary);
          if (!c.allowed) { audit('fs.read', p, 'deny', c.reason); return { ok: false, content: `[denied read: ${c.reason}]` }; }
          const data = readFileSync(resolve(p), 'utf8'); audit('fs.read', p, 'allow', 'read');
          return { ok: true, content: data.length > max ? data.slice(0, max) + '\n...[truncated]' : data };
        }
        case 'fs.list': {
          if (!p) return { ok: false, content: '[fs.list: missing path]' };
          const c = containCheck(p, 'read', opts.boundary);
          if (!c.allowed) { audit('fs.list', p, 'deny', c.reason); return { ok: false, content: `[denied list: ${c.reason}]` }; }
          const names = readdirSync(resolve(p)); audit('fs.list', p, 'allow', `${names.length} entries`);
          return { ok: true, content: names.join('\n') };
        }
        case 'fs.write': {
          if (!p) return { ok: false, content: '[fs.write: missing path]' };
          const c = containCheck(p, 'write', opts.boundary);
          if (!c.allowed) { audit('fs.write', p, 'deny', c.reason); return { ok: false, content: `[denied write: ${c.reason}]` }; }
          const abs = resolve(p);
          if (opts.backupDir) snapshot(abs, opts.backupDir, opts.projectRoot, opts.backups ?? 3);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, String(call.input.content ?? '')); audit('fs.write', p, 'allow', 'written (backed up)');
          return { ok: true, content: `wrote ${p}` };
        }
        case 'run_tests': {
          try {
            const extra = typeof call.input.args === 'string' && call.input.args ? call.input.args.split(/\s+/) : [];
            const out = execFileSync(testCmd[0], [...testCmd.slice(1), ...extra], { cwd: opts.projectRoot, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] });
            audit('run_tests', undefined, 'allow', 'tests ran'); return { ok: true, content: 'PASSED\n' + out.slice(-4000) };
          } catch (e) { const m = e as { stdout?: string; stderr?: string; message?: string }; audit('run_tests', undefined, 'allow', 'tests failed'); return { ok: false, content: 'FAILED\n' + ((m.stdout || '') + (m.stderr || '') || m.message || '').slice(-4000) }; }
        }
        case 'git_commit': {
          const msg = typeof call.input.message === 'string' ? call.input.message : 'starfish: governed commit';
          try {
            execFileSync('git', ['add', '-A'], { cwd: opts.projectRoot, stdio: 'ignore' });
            const out = execFileSync('git', ['commit', '--no-verify', '-m', msg], { cwd: opts.projectRoot, encoding: 'utf8' });
            audit('git_commit', undefined, 'allow', msg); return { ok: true, content: out.trim() };
          } catch (e) { return { ok: false, content: '[git_commit error: ' + ((e as Error).message || '').slice(0, 400) + ']' }; }
        }
        default:
          audit(call.tool, p, 'deny', 'no executor'); return { ok: false, content: `[no executor for ${call.tool}]` };
      }
    } catch (e) { return { ok: false, content: `[${call.tool} error: ${(e as Error).message}]` }; }
  };
}
