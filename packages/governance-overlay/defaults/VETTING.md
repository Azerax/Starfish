# Default skills — vetting results (Toby)

Vetted from source (anthropics/skills `SKILL.md`) on 2026-06-14 with `governance-core/src/vetting.ts`.
All 17 carry provenance `anthropics/skills`, a **trusted publisher** — so they are adjudicated
**low / auto-registered (enabled)**. Trust is a *registration* decision about the publisher; it is
**not** a runtime grant: every tool call a skill makes still passes the PDP (default-deny gate,
per-skill boundary, task-binding, hash-on-vet, audit). Destructive ops (`rm -rf`, `mkfs`, `dd`) are
the one exception — they stay quarantined even for a trusted publisher. `contentHash` is empty in the
seed, so installing the real source forces a full file-level re-vet.

| Skill | Plugin | Raw signals | Adjudicated | Status |
|---|---|---|---|---|
| frontend-design | example-skills | none | low | enabled |
| canvas-design | example-skills | none | low | enabled |
| brand-guidelines | example-skills | none | low | enabled |
| internal-comms | example-skills | none | low | enabled |
| doc-coauthoring | example-skills | none | low | enabled |
| theme-factory | example-skills | none | low | enabled |
| slack-gif-creator | example-skills | none | low | enabled |
| docx | document-skills | fs-write + source-available license | low (trusted) | enabled |
| pdf | document-skills | fs-write + source-available license | low (trusted) | enabled |
| pptx | document-skills | fs-write + source-available license | low (trusted) | enabled |
| xlsx | document-skills | fs-write + source-available license | low (trusted) | enabled |
| algorithmic-art | example-skills | network (CDN) | low (trusted) | enabled |
| skill-creator | example-skills | code-exec (spawn) | low (trusted) | enabled |
| mcp-builder | example-skills | network | low (trusted) | enabled |
| web-artifacts-builder | example-skills | exec + network | low (trusted) | enabled |
| webapp-testing | example-skills | exec + network | low (trusted) | enabled |
| claude-api | claude-api | network | low (trusted) | enabled |

**Result: all 17 enabled via the trusted-publisher allowlist.** Raw signals are retained in each
vetting report for transparency. A non-trusted publisher shipping the same code would be quarantined
(see `vetting.trusted.conformance.test.ts`). Licensing note: document-skills remain source-available —
confirm commercial terms before redistribution (a legal, not runtime, concern).
