---
name: starfish-notes
description: Turn a meeting transcript or raw notes into a clean summary with decisions and action items. Use whenever the user shares a transcript/notes and wants them written up: "summarize this meeting", "turn these notes into minutes", "pull the action items out", "what did we decide".
---

Turn a transcript or notes into a clean summary + actions — governed.

## When to use
"Summarize this meeting", "make minutes from this transcript", "extract the action items and owners", "write up what we discussed".

## Governed tools it uses
- `fs.read` (working folder) for the transcript/notes the user picked.
- `fs.write` (working folder) for the summary.
- Optionally hands action items to `starfish-schedule` (reminders) or opens governed tasks — only on the user's say-so.
No network, no shell.

## Steps
1. Read the transcript/notes.
2. Produce: a short summary, key decisions, and action items (owner + what + due if stated).
3. Save the write-up to the working folder; offer to set reminders / open tasks for the actions.

## Output
A `.md` (or `.docx` via starfish-docx) summary in the working folder, provenance-stamped.

## Governance notes
Reading and summarizing is routine. Creating reminders or tasks from the actions is a separate step the user confirms. Nothing is sent anywhere.

## Provenance
Built-in, trusted Starfish skill (authored).
