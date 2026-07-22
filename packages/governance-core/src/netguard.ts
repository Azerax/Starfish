// Egress destination guard (audit A8). Deny outbound governed `net` calls to internal / loopback /
// link-local / cloud-metadata hosts by default; hosts opt IN via an allowlist. Denylist here is a
// belt for the private ranges; the real control is that non-allowlisted internal targets are refused.
const PRIVATE = [
  /^127\./, /^0\.0\.0\.0$/, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./,
];

// F19: IPv6 internal ranges. The old guard was IPv4-only and blocked exactly one IPv6 literal (`::1`),
// so loopback (mapped, hex form), link-local (fe80::/10), unique-local (fc00::/7), and metadata over
// v6 all slipped through. `new URL()` normalizes `[::ffff:127.0.0.1]` to the hex form `::ffff:7f00:1`,
// which the dotted-decimal mapped regex never matched — so both forms must be handled.
const PRIVATE_V6 = [
  /^::1$/,                       // loopback
  /^::$/,                        // unspecified
  /^fe80:/i,                     // link-local  fe80::/10
  /^f[cd][0-9a-f]{2}:/i,         // unique-local fc00::/7  (fc.. and fd..)
  /^::ffff:/i,                   // IPv4-mapped in hex form (e.g. ::ffff:7f00:1) — resolve + re-check below
  /^64:ff9b:/i,                  // NAT64 well-known prefix
];

// Parse the four octets of an IPv4-mapped IPv6 address in EITHER form:
//   dotted: ::ffff:127.0.0.1   |   hex: ::ffff:7f00:1
function mappedV4(host: string): string | undefined {
  const dotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return undefined;
}

export function isBlockedHost(input: string, allow: string[] = []): boolean {
  let host = (input || '').trim();
  try { host = new URL(host.includes('://') ? host : 'http://' + host).hostname; } catch { /* use raw */ }
  host = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  host = host.replace(/\.$/, '');                                   // trailing FQDN dot: 'localhost.' == 'localhost'
  const mapped = mappedV4(host);                                    // IPv4-mapped IPv6 (dotted OR hex) → judge the IPv4
  if (mapped) host = mapped;
  // F12: an empty or malformed host (URL parse failed and the raw fallback still holds a slash /
  // whitespace, e.g. 'http://') fails CLOSED — we could not determine the destination, so block.
  if (!host || /[/\s]/.test(host)) return true;
  if (allow.map((a) => a.toLowerCase().replace(/\.$/, '')).includes(host)) return false;
  if (host === 'localhost' || host === '169.254.169.254') return true;
  if (host.endsWith('.internal') || host.endsWith('.local')) return true;
  if (PRIVATE.some((re) => re.test(host))) return true;
  return PRIVATE_V6.some((re) => re.test(host));
}
