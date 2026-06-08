// Egress content containment — the single place that defines "unsafe to release".
// Used by the PDP (tool-result egress) and the MessageRouter (message-body egress) so the
// rule never drifts between transports. Extend SECRET_PATTERNS in one place.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
];
export function scanEgress(text: string): { clean: boolean; reason?: string } {
  for (const re of SECRET_PATTERNS) if (re.test(text)) return { clean: false, reason: 'egress-blocked: secret material' };
  return { clean: true };
}
