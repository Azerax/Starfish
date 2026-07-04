# Starfish External - GA Checklist (Wave 5)

Gates before calling the embeddable surface generally available. Ties to docs/EMBED_RISK_REGISTER.md.

## Integrity and fail-safe (built)
- [x] Audit hash-chain verified on boot; tamper -> safe mode (deny-all) (risk 8).
- [x] Fail-closed: no decision -> deny; sidecar down -> deny (risk 7).
- [x] proposer != approver enforced in-process and over HTTP via server-assigned identity (risks 3, 13).
- [x] Wire-version handshake; mismatch refused (risk 14).
- [x] Deny-by-default seed; root-safety + cloud-FS guards; schema stamp fail-closed (risks 12, 15, 46, 80).
- [x] `starfish doctor --embed`: schema, audit chain, safe mode, token perms, no blanket allow.

## Supply chain (release-time)
- [x] Publish `@starfish/sdk` + `@starfish/ui` from CI only, with npm provenance.
- [x] SBOM attached per release (scripts/sbom.mjs).
- [ ] release.ps1 gates on install + test + build; every published tag == a green `starfish-verify` run.
- [ ] Never amend a pushed commit (learned: caused a non-fast-forward + tag conflict).

## Public API + compatibility (risk 23)
- [x] Freeze the exported surface of `@starfish/sdk` / `@starfish/ui`; semver from first publish.
- [x] Wire-protocol version documented; bump policy defined.
- [x] Deprecation policy + changelog discipline.

## Data lifecycle (risks 29, 37, 38, 40)
- [x] Audit rotation with chained roots + retention policy.
- [x] Audit reason redaction (secret-scan) before write.
- [ ] Backup dir secret-scan / encryption; purge policy.

## Legal / brand (risks 68-71)
- [ ] "Governed by Starfish" mark usage terms (TRADEMARK.md).
- [ ] Commercial-embedding terms (COMMERCIAL.md); no-warranty + scope statement.
- [ ] Counsel review before external design-partner launch.

## Design-partner readiness (positioning)
- [ ] Zero-change demo recorded (sidecar in front of an unmodified skill; approval in host UI).
- [ ] 10-minute integration guide per host type.
- [ ] Partner feedback loop open BEFORE the API is frozen.
