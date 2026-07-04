# Project Starfish v0.15.0 - Egress + shell containment

## Security
- Net egress guard (`isBlockedHost`): governed `net` calls to internal/loopback/link-local/cloud-metadata
  hosts are denied by default (allowlist to opt in); wired into the hook seam so an arbitrary-URL fetch can
  no longer be the exfiltration channel (audit A8).
- Hardened catastrophic-shell denylist with a bypass corpus: flag reordering and long-form
  (`rm -fr /`, `rm --recursive --force /`), more interpreter pipes, `chmod 777` on system paths,
  `find / -delete`, `truncate ... /dev/` are now caught (audit A7).

Verified: typecheck + dep-lint + 392 tests + CLI bundle green.
