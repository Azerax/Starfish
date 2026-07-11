---
name: starfish-xlsx
description: Create, edit, clean, and analyze spreadsheets (.xlsx/.csv) — budgets, trackers, data cleanup, formulas, charts. Use whenever the user wants a spreadsheet produced or fixed, mentions ".xlsx"/".csv"/"Excel", "clean up this data", "make a budget/tracker", or wants tabular data organized or computed.
---

Create or fix a spreadsheet, governed.

## When to use
"Clean up this spreadsheet", "build a budget", "add a column that computes X", "turn this messy CSV into a proper table", "chart this data".

## Governed tools it uses
- `fs.read` (working folder) for the source sheet/CSV.
- `fs.write` (working folder) for the result.
No network, no shell.

## Steps
1. Read the source (a file the user picked) and show what you found (rows, columns, obvious problems).
2. Confirm the change (clean / compute / restructure / chart) in one line.
3. Apply it deterministically; keep the original untouched, write a new file.
4. Report the new file name + a one-line summary of what changed; offer "reveal file".

## Output
A `.xlsx` (or `.csv`) in the working folder, provenance-stamped. The original is never overwritten.

## Governance notes
Reading a user-picked sheet and writing a new one in the working folder is routine and quiet. Bulk deletes, overwriting the source, or touching files outside the working folder escalate for approval.

## Provenance
Built-in, trusted Starfish skill. Spreadsheet engine imported from `anthropics/skills` (xlsx) and Arena-vetted + signed before release.
