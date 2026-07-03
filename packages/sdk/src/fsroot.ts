// Filesystem guards for a governed root. Cross-platform: checks both the raw input and the resolved
// path so Windows-style paths are caught even when the verifier runs on Linux (and vice versa).
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Cloud-synced or UNC roots corrupt governance state (learned the hard way with a git index on
// OneDrive). Refuse unless the operator explicitly opts in.
export function assertLocalRoot(root: string, allowCloud = false): void {
  if (allowCloud) return;
  const p = root.replace(/\\/g, '/').toLowerCase();
  const bad = ['/onedrive', '/dropbox', '/google drive', '/googledrive', '/box/', '/box sync'];
  const isUnc = root.startsWith('\\\\') || root.startsWith('//');
  if (isUnc || bad.some((b) => p.includes(b))) {
    throw new Error(`governed root looks cloud-synced/network (${root}); use a local path or pass allowCloudFs (fail-closed)`);
  }
}

// Reject dangerous roots: a filesystem/drive root, the home directory itself, or a system directory.
// A governed root must be a project-scoped folder, not the whole machine.
export function assertSafeRoot(root: string): void {
  const raw = root.trim();
  const rawNorm = (raw.replace(/\\/g, '/').replace(/\/+$/, '') || '/');
  const rawLow = rawNorm.toLowerCase();
  if (/^[a-zA-Z]:[\\/]?$/.test(raw)) throw new Error(`refused: governed root cannot be a drive root (${root})`);
  const abs = resolve(root);
  const absNorm = abs.replace(/\\/g, '/');
  const absLow = absNorm.toLowerCase();
  if (absNorm === '/' || rawNorm === '/') throw new Error(`refused: governed root cannot be the filesystem root (${root})`);
  if (/^[a-z]:\/?$/i.test(absNorm)) throw new Error(`refused: governed root cannot be a drive root (${root})`);
  if (abs === resolve(homedir())) throw new Error(`refused: governed root cannot be the home directory itself (${root}); use a subfolder`);
  const sys = ['/etc', '/usr', '/bin', '/sbin', '/sys', '/proc', '/var', '/boot', '/dev', 'c:/windows', 'c:/program files', 'c:/program files (x86)'];
  const hit = (s: string): boolean => sys.some((d) => s === d || s.startsWith(d + '/'));
  if (hit(absLow) || hit(rawLow)) throw new Error(`refused: governed root is a system directory (${root})`);
}
