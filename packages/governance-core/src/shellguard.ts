// Catastrophic-shell denylist — a HARD FLOOR, enforced in the PDP so every surface inherits it.
//
// History (adversarial review F-11): this list originally lived only in @starfish/governance-hooks,
// so it protected the Claude Code overlay and nothing else. A consumer embedding the SDK
// (`createGovernance`/`governCall`) or talking to `starfish serve` got NO catastrophic-shell
// screening at all, while the docs described it as a floor "enforced independently of any policy or
// tolerance". Moving it here makes that sentence true: the check now runs inside PDP.ingress, ahead
// of policy and tolerance, on every transport. The hooks package re-exports it and still calls it as
// a fast pre-filter, so the overlay's behaviour is unchanged.
//
// This is a DENYLIST and is therefore probability-reducing, not authority-reducing: an adversary who
// has read it can phrase around it. It is a floor against accident and blunt attack, not a boundary.
// The authority-reducing controls are the filesystem boundary, the secret gate, and the command
// templates (the only sanctioned exec surface).
const CATASTROPHIC: RegExp[] = [
  // rm with a recursive/force flag (any order/long-form) targeting root, home, glob, or a system tree
  String.raw`\brm\b(?=.*(?:\s-\w*[rf]\w*|--recursive|--force))(?=.*\s(?:/(?:\s|$)|~(?:\s|$)|\*(?:\s|$)|\$HOME|/(?:etc|usr|var|bin|sbin|boot|dev|lib|sys|root|home)\b))`,
  String.raw`\brm\b[^\n]*--no-preserve-root`,
  String.raw`\bmkfs`,
  String.raw`\bdd\b[^\n]*\bof=/dev/`,
  String.raw`:\s*\(\s*\)\s*\{[^}]*\}\s*;`,
  // F23: pipe-to-interpreter — powershell/pwsh/php/deno/bun/lua/Rscript/awk included.
  String.raw`\b(?:curl|wget|fetch)\b[^\n]*\|\s*(?:sh|bash|zsh|dash|python3?|perl|ruby|node|powershell|pwsh|php|deno|bun|lua|Rscript|awk)\b`,
  String.raw`\bchmod\b[^\n]*(?:-R\s+)?0?777\b[^\n]*\s(?:/|~)`,
  // F23: any write to a raw disk device — NVMe, virtio, mmc, xvd, hd, not just sd[a-z].
  String.raw`>\s*/dev/(?:sd[a-z]|nvme\d|vd[a-z]|mmcblk\d|xvd[a-z]|hd[a-z])`,
  String.raw`\bfind\s+/\S*\s[^\n]*-(?:delete|exec\s+rm)\b`,
  String.raw`\btruncate\b[^\n]*-s\s*0[^\n]*/dev/`,
  // F23: rm -rf targeting the cwd/project ITSELF — '.' or './' as a whole token, or $PWD.
  // './build' (a subdirectory) is deliberately NOT matched (legitimate).
  String.raw`\brm\b(?=[^\n]*(?:\s-\w*[rf]\w*|--recursive|--force))(?=[^\n]*(?:\s(?:\.|\./)(?:\s|;|$)|\$\{?PWD))`,
].map((p) => new RegExp(p, 'i'));

export function isCatastrophicShell(cmd: string): boolean { return CATASTROPHIC.some((re) => re.test(cmd)); }

/** Every string-valued input on a call, for screening exec-shaped tools whose command may arrive
 *  under any key (`command`, `cmd`, `script`, `argv[0]`, …). Bounded to strings; arrays flattened. */
export function commandStrings(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(input ?? {})) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  }
  return out;
}
