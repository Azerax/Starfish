---
name: starfish-pptx
description: Build and edit slide decks (.pptx) — pitch decks, status briefings, summaries from notes. Use whenever the user wants slides or a presentation, mentions ".pptx"/"PowerPoint"/"deck"/"slides", or wants content turned into a presentation.
---

Build a slide deck, governed.

## When to use
"Make a deck about X", "turn these notes into slides", "build a status briefing", "update slide 4".

## Governed tools it uses
- `fs.read` (working folder) for source material / an existing deck.
- `fs.write` (working folder) for the deck.
No network, no shell.

## Steps
1. Confirm the audience, number of slides, and key points (one short question if unclear).
2. Draft an outline (one line per slide), then build the deck.
3. Save to the working folder; report the file name + offer "reveal file".

## Output
A `.pptx` in the working folder, provenance-stamped.

## Governance notes
Building a deck from conversation content and user-picked files is routine and quiet. Reading unpicked files or writing outside the working folder escalates.

## Provenance
Built-in, trusted Starfish skill. Presentation engine imported from `anthropics/skills` (pptx) and Arena-vetted + signed before release.
