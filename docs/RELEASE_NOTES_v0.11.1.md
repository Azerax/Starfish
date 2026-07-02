# Project Starfish v0.11.1

Patch release. No runtime changes from v0.11.0 - a test and changelog catch-up.

## Fixed
- **Tool-schema conformance test** aligned with the wire-safe tool names shipped in v0.11.0
  (`fs.read`/`fs.write` are sent as `fs__read`/`fs__write`; the parser unwires them back). The test
  now also verifies no dotted names go over the wire and that the round-trip restores the governed
  name. The runtime was correct in v0.11.0; only the test asserted the pre-fix names.
- Restored the **v0.11.0 CHANGELOG entry** that a stale file cache dropped from the tagged commit.
