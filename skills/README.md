# Starfish built-in skills

The skills that ship **with** Starfish — trusted by provenance, Arena-vetted, and signed at build time. These are what a new user can do on day one (see `docs/PERSONAS_AND_GAPS.md` for who they're for). External skills a user brings in are separate: they go through `starfish govern` / intake (`packages/governance-overlay/defaults/default-skills.json`) and are quarantined until vetted.

Every skill here runs **governed**: gated + audited, quiet on routine safe steps, escalating only when it should. None can send data outward or run raw shell.

## The 10 launch skills

| Skill | Does | Governed by |
|---|---|---|
| `starfish-docx` | Word documents | fs (working folder), provenance output |
| `starfish-xlsx` | Spreadsheets | fs; original never overwritten |
| `starfish-pdf` | PDF toolkit | fs; external PDFs caged first |
| `starfish-pptx` | Slide decks | fs |
| `starfish-research` | Web research → cited brief | governed net + taint (no exfil) |
| `starfish-organizer` | Sort/rename/dedupe/find | Custodian soft-delete (recoverable) |
| `starfish-compose` | Draft emails/messages | **draft-only, no send** |
| `starfish-notes` | Transcript → summary + actions | fs |
| `starfish-recall` | Persistent memory | governed memory pipeline |
| `starfish-schedule` | Reminders + recurring jobs | scheduled-task engine, re-scored at fire time |

## Governance-native skills
- `starfish-govern` — bring any build under governance.
- `starfish-verify` — clean-room gate runner.

## Status
SKILL.md scaffolds authored (metadata + governed-tool bindings + instructions). Remaining to fully package: import the `document-*` rendering engines from `anthropics/skills`, run all 10 through the Arena, sign, and register via `starter-skills.json`. Manifest: `starter-skills.json`.
