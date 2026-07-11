---
name: starfish-compose
description: Draft emails and messages — replies, outreach, announcements. Use whenever the user wants something written to send: "draft an email to X", "reply to this", "write a message about Y", "help me respond". Drafts only — the user always sends.
---

Draft a message for the user to send — never sends on its own.

## When to use
"Draft an email declining this", "reply to this thread", "write a note to the team about X", "help me respond to this message".

## Governed tools it uses
- `fs.read` (working folder) for context (a thread, a doc) the user picked.
- `fs.write` (working folder) to save the draft.
**No send capability.** Sending a message is an explicit, human-performed action — this skill produces a draft and stops.

## Steps
1. Get the recipient, intent, and tone in one line.
2. Draft the message; offer 1–2 alternates (shorter / warmer) if useful.
3. Save the draft (and/or show it inline) for the user to copy and send themselves.

## Output
A message draft (inline + saved `.md`/`.txt` in the working folder). The user sends it.

## Governance notes
Drafting is Low risk and quiet. This skill has no outbound/send tool by design — per governance, sending on the user's behalf always requires the user. If a send connector is later added, it stays a separate, explicitly-approved action.

## Provenance
Built-in, trusted Starfish skill (authored). Draft-only by construction.
