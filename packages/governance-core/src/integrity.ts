// Runtime skill-integrity: no-follow reads, total symlink rejection, and a triple-hash
// (before/during/after) execution guarantee. Drift or symlinks => auto-quarantine + Critical audit.
import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { hashFiles } from './vetting';
import type { CapabilityLedger, CapabilityFile } from './vetting';

/** Read files RELATIVE to dir. NEVER follows symlinks — symlinks are not allowed in skill trees. */
export function readSkillFiles(dir: string): CapabilityFile[] {
  const out: CapabilityFile[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;            // do not follow or read symlinks
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) { try { out.push({ path: p.slice(dir.length + 1).split(sep).join('/'), content: readFileSync(p, 'utf8') }); } catch { /* skip */ } }
    }
  };
  walk(dir);
  return out;
}

/** Any symlink paths under dir (relative). Skills containing symlinks are rejected outright. */
export function scanSymlinks(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { found.push(p.slice(dir.length + 1).split(sep).join('/')); continue; }
      if (st.isDirectory()) walk(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
}

export interface IntegrityGate { verify(capabilityId: string): { ok: boolean; changed?: string[]; reason?: string }; }

export function fileIntegrityGate(ledger: CapabilityLedger, skillsRoot: string): IntegrityGate {
  return {
    verify(id: string) {
      const dir = join(skillsRoot, id, 'source');
      if (!existsSync(dir)) return { ok: false, changed: ['<source missing>'], reason: 'skill source not found' };
      const links = scanSymlinks(dir);
      if (links.length) { ledger.quarantine(id, `symlink(s) present: ${links.join(', ')} — not allowed`); return { ok: false, changed: links.map((l) => `symlink:${l}`), reason: 'symlink present — not allowed' }; }
      return ledger.enforceIntegrity(id, readSkillFiles(dir));
    },
  };
}

/** Triple-hash guarantee: hash BEFORE, snapshot the exact bytes DURING, re-hash AFTER execution.
 *  Any mismatch at any point => tamper => auto-quarantine. `read` re-reads from disk each time. */
export interface VerifiedRun<T> { ok: boolean; result?: T; reason?: string; changed?: string[]; }
export function runWithIntegrity<T>(ledger: CapabilityLedger, id: string, read: () => CapabilityFile[], exec: () => T): VerifiedRun<T> {
  const before = ledger.enforceIntegrity(id, read());          // BEFORE — matches recorded manifest?
  if (!before.ok) return { ok: false, reason: before.reason, changed: before.changed };
  const during = hashFiles(read());                            // DURING — snapshot the bytes about to run
  let result: T;
  try { result = exec(); } catch (e) { return { ok: false, reason: `exec-failed: ${(e as Error).message}` }; }
  const afterFiles = read();
  const after = ledger.enforceIntegrity(id, afterFiles);       // AFTER — re-check vs manifest
  if (!after.ok || hashFiles(afterFiles) !== during) {         // changed mid-run
    ledger.quarantine(id, 'integrity drift during execution (before/during/after mismatch)');
    return { ok: false, reason: 'integrity drift during execution — quarantined', changed: after.changed ?? ['<changed during run>'] };
  }
  return { ok: true, result };
}
