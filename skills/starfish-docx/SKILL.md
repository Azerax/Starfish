---
name: starfish-docx
description: Create, edit, and format Word (.docx) documents — reports, letters, resumes, memos, meeting summaries, policies. Use whenever the user wants a Word document produced or changed, mentions ".docx", "Word doc", "write a report/letter/memo", or wants prose turned into a formatted document.
---

Produce or edit a polished Word document, governed.

## When to use
The user asks for a document: "write a report on X", "turn these notes into a letter", "format this as a memo", "update the resume", or references a `.docx` file.

## Governed tools it uses
- `fs.read` (inside the working folder) to read source material or an existing `.docx`.
- `fs.write` (inside the working folder) to save the result.
No network, no shell. Files created here are **trusted by provenance** (Starfish-authored output); an external `.docx` the user drops in is quarantined and CDR-checked first (see the File Arena).

## Steps
1. Confirm the goal, audience, and length if unclear (one short question, not many).
2. Gather content from the conversation and any user-picked source files (read-only).
3. Build the document (headings, sections, tables, page numbers, letterhead as needed) using the imported document engine.
4. Save to the working folder and tell the user the exact file name + offer "reveal file".

## Output
A `.docx` in the user's working folder, provenance-stamped (agent + task + timestamp + hash).

## Governance notes
Routine (read a file the user picked, write inside the working folder) is Low/Medium risk and runs without nagging. Writing outside the working folder, or reading a file the user didn't pick, escalates for approval. Never sends anything anywhere.

## Provenance
Built-in, trusted Starfish skill. Rendering implementation imported from `anthropics/skills` (docx) and Arena-vetted + signed before release.
