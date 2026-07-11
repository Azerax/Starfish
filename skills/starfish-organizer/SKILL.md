---
name: starfish-organizer
description: Organize files — sort, rename, dedupe, and find within a folder the user picks. Use whenever the user wants files tidied, "clean up my Downloads", "organize these files", "find duplicates", "rename these by date", "where is the file about X".
---

Tidy a folder the user picks — governed, reversible, never destructive.

## When to use
"Organize this folder", "sort my Downloads by type", "find and remove duplicates", "rename these consistently", "find the file about X".

## Governed tools it uses
- `fs.read` / `fs.list` (the picked folder) to inventory.
- `fs.write` / rename within the folder.
- Governed **soft-delete via the Custodian** — deletes are impact-assessed and move to trash (recoverable). Hard rules: never system files, never skills, never whole folders.
No network, no shell.

## Steps
1. Inventory the folder the user picked and propose a plan (what moves/renames/dedupes).
2. Show the plan and the count of affected files; get a go-ahead for anything destructive.
3. Apply moves/renames; route any deletions through the Custodian (soft, recoverable).
4. Report what changed and how to undo it.

## Output
A tidied folder + a short change log ("moved 12, renamed 8, 3 duplicates sent to trash — restorable").

## Governance notes
Reading and inventorying are quiet. Every deletion is soft and recoverable; folder-deletes and system paths are hard-denied regardless of Risk Tolerance. Nothing leaves the machine.

## Provenance
Built-in, trusted Starfish skill (authored). Uses the governed deletion gate + Custodian.
