// Egress destination guard (audit A8). Deny outbound governed `net` calls to internal / loopback /
// link-local / cloud-metadata hosts by default; hosts opt IN via an allowlist. Denylist here is a
// belt for the private ranges; the real control is that non-allowlisted internal targets are refused.
const PRIVATE = [
  /^127\./, /^0\.0\.0\.0$/, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./,
];
export function isBlockedHost(input: string, allow: string[] = []): boolean {
  let host = (input || '').trim();
  try { host = new URL(host.includes('://') ? host : 'http://' + host).hostname; } catch { /* use raw */ }
  host = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  host = host.replace(/\.$/, '');                                   // trailing FQDN dot: 'localhost.' == 'localhost'
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);  // IPv4-mapped IPv6 → judge the IPv4
  if (mapped) host = mapped[1];
  if (!host) return false;
  if (allow.map((a) => a.toLowerCase().replace(/\.$/, '')).includes(host)) return false;
  if (host === 'localhost' || host === '::1' || host === '169.254.169.254') return true;
  if (host.endsWith('.internal') || host.endsWith('.local')) return true;
  return PRIVATE.some((re) => re.test(host));
}
