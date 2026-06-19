// Host filesystem layer for governed deletion (ring 3). Real recursive FsProbe + a recoverable
// TrashStore (move/list/restore/purge). The CORE deletion gate (assessDeletion/governedDelete) makes
// the decision and the hard rules; this only performs the I/O once the gate says yes — SOFT (move to
// a per-workspace trash), never an unlink. Permanent removal is `purge`, a higher-tier operator act.
import { existsSync, lstatSync, statSync, readdirSync, mkdirSync, renameSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assessDeletion, governedDelete, type FsProbe, type DeleteOps, type DeletionConfig, type GovernedDeleteResult, type PDP, type ToolCall, type BoundarySet, type AuditLog } from '@starfish/governance-core';

/** Real recursive probe. Never follows symlinks (lstat), counts up to `cap` files. */
export function realFsProbe(): FsProbe {
  return {
    exists: (p) => existsSync(p),
    isDirectory: (p) => { try { return lstatSync(p).isDirectory(); } catch { return false; } },
    measure: (p, cap) => {
      let files = 0, bytes = 0, truncated = false;
      const walk = (cur: string): void => {
        if (files >= cap) { truncated = true; return; }
        let st; try { st = lstatSync(cur); } catch { return; }
        if (st.isSymbolicLink()) { files += 1; return; }            // count the link, don't traverse
        if (st.isDirectory()) { for (const e of readdirSync(cur)) { if (files >= cap) { truncated = true; break; } walk(join(cur, e)); } }
        else { files += 1; bytes += st.size; }
      };
      walk(p);
      return { files, bytes, truncated };
    },
  };
}

export interface TrashEntry { id: string; originalPath: string; trashedAt: string; name: string; }

/** A per-workspace, recoverable trash. Each entry is <trashDir>/<id>/{file, .meta.json}. */
export class TrashStore {
  constructor(private trashDir: string) { mkdirSync(trashDir, { recursive: true }); }

  /** Move a FILE into the trash (folders are rejected upstream by the gate). Returns the trash path. */
  move(srcPath: string): { id: string; trashPath: string; entry: TrashEntry } {
    if (!existsSync(srcPath)) throw new Error(`nothing to delete: ${srcPath}`);
    if (lstatSync(srcPath).isDirectory()) throw new Error('refusing to trash a directory (hard rule: no folders)');
    const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const slot = join(this.trashDir, id);
    mkdirSync(slot, { recursive: true });
    const name = basename(srcPath);
    const dest = join(slot, name);
    try { renameSync(srcPath, dest); } catch { copyFileSync(srcPath, dest); rmSync(srcPath); }   // cross-device fallback
    const entry: TrashEntry = { id, originalPath: srcPath, trashedAt: new Date().toISOString(), name };
    writeFileSync(join(slot, '.meta.json'), JSON.stringify(entry, null, 2));
    return { id, trashPath: dest, entry };
  }

  list(): TrashEntry[] {
    if (!existsSync(this.trashDir)) return [];
    const out: TrashEntry[] = [];
    for (const id of readdirSync(this.trashDir)) {
      const meta = join(this.trashDir, id, '.meta.json');
      if (existsSync(meta)) { try { out.push(JSON.parse(readFileSync(meta, 'utf8')) as TrashEntry); } catch { /* skip */ } }
    }
    return out.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  }

  /** Restore a trashed file to its original path. Refuses to clobber an existing file. */
  restore(id: string): { ok: boolean; restoredTo?: string; reason: string } {
    const slot = join(this.trashDir, id);
    const meta = join(slot, '.meta.json');
    if (!existsSync(meta)) return { ok: false, reason: 'no such trash entry' };
    const entry = JSON.parse(readFileSync(meta, 'utf8')) as TrashEntry;
    if (existsSync(entry.originalPath)) return { ok: false, reason: 'a file already exists at the original path' };
    const src = join(slot, entry.name);
    mkdirSync(dirname(entry.originalPath), { recursive: true });
    try { renameSync(src, entry.originalPath); } catch { copyFileSync(src, entry.originalPath); rmSync(src); }
    rmSync(slot, { recursive: true, force: true });
    return { ok: true, restoredTo: entry.originalPath, reason: 'restored' };
  }

  /** PERMANENT removal of one entry (higher-tier: caller must gate on operator confirmation). */
  purge(id: string): boolean {
    const slot = join(this.trashDir, id);
    if (!existsSync(slot)) return false;
    rmSync(slot, { recursive: true, force: true });
    return true;
  }
  purgeAll(): number { const n = this.list().length; rmSync(this.trashDir, { recursive: true, force: true }); mkdirSync(this.trashDir, { recursive: true }); return n; }
}

/** DeleteOps adapter so the core gate can perform the soft delete through a TrashStore. */
export function trashOps(store: TrashStore): DeleteOps {
  return { moveToTrash: (path: string) => store.move(path).trashPath };
}

/** Convenience: run the full governed delete with the real probe + a TrashStore. */
export function governedCustodianDelete(pdp: PDP, call: ToolCall, bs: BoundarySet, deps: { cfg: DeletionConfig; store: TrashStore; trashDir: string; audit: AuditLog; approved?: boolean }): GovernedDeleteResult {
  return governedDelete(pdp, call, bs, { probe: realFsProbe(), cfg: deps.cfg, ops: trashOps(deps.store), trashDir: deps.trashDir, audit: deps.audit, approved: deps.approved });
}

export { assessDeletion };
