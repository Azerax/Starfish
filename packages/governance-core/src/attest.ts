// Input re-provenance (hardening H5). A file a task picks can change between pick-time and use-time —
// a shared/cloud-synced file edited by someone else, or an attacker swapping it (TOCTOU). We stamp the
// file when it's picked and re-verify at use; a changed hash is treated as a deviation, not trusted input.
// (This is the exact class behind our own OneDrive-lag incidents.)
import { statSync, readFileSync } from 'node:fs';
import { sha256 } from './hash';

export interface FileStamp { path: string; hash: string; size: number; mtimeMs: number }

/** Byte-accurate content hash + stat. Returns null if the file is missing/unreadable. */
export function stampFile(path: string): FileStamp | null {
  try {
    const st = statSync(path);
    const hash = sha256(readFileSync(path).toString('latin1')); // latin1 is 1:1 with bytes → binary-safe
    return { path, hash, size: st.size, mtimeMs: st.mtimeMs };
  } catch { return null; }
}

export interface AttestResult { ok: boolean; changed: boolean; reason: string }

/** Re-verify a file at time-of-use against the stamp taken when it was picked. A cheap mtime/size
 *  pre-check skips re-hashing unchanged files; a hash mismatch (or a missing file) fails closed. */
export function verifyStamp(prev: FileStamp): AttestResult {
  const now = stampFile(prev.path);
  if (!now) return { ok: false, changed: true, reason: 'file missing or unreadable at use' };
  if (now.mtimeMs === prev.mtimeMs && now.size === prev.size && now.hash === prev.hash) return { ok: true, changed: false, reason: 'unchanged' };
  if (now.hash !== prev.hash) return { ok: false, changed: true, reason: 'file content changed since it was picked (TOCTOU / cloud-sync)' };
  return { ok: true, changed: false, reason: 'unchanged (metadata differs, content identical)' };
}

/** Stamp a set of picked files (task pathScope inputs). */
export function stampFiles(paths: string[]): FileStamp[] {
  const out: FileStamp[] = [];
  for (const p of paths) { const s = stampFile(p); if (s) out.push(s); }
  return out;
}

/** Verify a set; returns the first deviation, or ok. */
export function verifyStamps(stamps: FileStamp[]): AttestResult {
  for (const s of stamps) { const r = verifyStamp(s); if (!r.ok) return r; }
  return { ok: true, changed: false, reason: 'all inputs unchanged' };
}
