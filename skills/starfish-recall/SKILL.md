---
name: starfish-recall
description: Capture and retrieve personal/work knowledge across sessions — "remember that…", "what did I decide about X", "what do I know about Y". Persistent, governed memory the user can trust and review.
---

Remember and recall — backed by Starfish's governed memory, not an unverified blob.

## When to use
"Remember that our vendor renews in March", "what did I decide about the pricing?", "what do I know about project X", "save this for later".

## Governed tools it uses
- The **governed memory pipeline** (evidence → claims → approval → canonical knowledge). Nothing is "remembered because the model said so": captures are provenance-stamped, and recall reads only approved knowledge.
- `fs.read`/`fs.write` (working folder) for any exported notes.
No network, no shell.

## Steps
1. **Capture:** record the fact with its source + timestamp as evidence; propose a claim.
2. **Recall:** answer from approved knowledge, citing when/where it came from; if uncertain, say so rather than guess.
3. Offer to export a topic to a note in the working folder.

## Output
A durable, reviewable memory entry (and optional exported `.md`). Every entry shows its provenance.

## Governance notes
Low risk and quiet for capture/recall. Memory is local and provenance-first; the user can review or remove what's stored. Sensitive personal data isn't retained unless the user explicitly asks.

## Provenance
Built-in, trusted Starfish skill (authored). Uses the governed memory architecture.
