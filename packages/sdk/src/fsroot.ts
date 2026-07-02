// Cloud/network filesystem guard: cloud-synced or UNC roots corrupt governance state (learned the hard
// way with a git index on OneDrive). Refuse unless the operator explicitly opts in.
export function assertLocalRoot(root: string, allowCloud = false): void {
  if (allowCloud) return;
  const p = root.replace(/\\/g, '/').toLowerCase();
  const bad = ['/onedrive', '/dropbox', '/google drive', '/googledrive', '/box/', '/box sync'];
  const isUnc = root.startsWith('\\\\') || root.startsWith('//');
  if (isUnc || bad.some((b) => p.includes(b))) {
    throw new Error(`governed root looks cloud-synced/network (${root}); use a local path or pass allowCloudFs (fail-closed)`);
  }
}
