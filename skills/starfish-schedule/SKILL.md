---
name: starfish-schedule
description: Set reminders and recurring jobs — "remind me tomorrow", "every Monday do X", "run this each morning", "in an hour". Governed background work that stays on-mission.
---

Schedule reminders and recurring governed tasks.

## When to use
"Remind me to send the invoice Friday", "every morning summarize my new files", "run the weekly report each Monday", "in two hours, check X".

## Governed tools it uses
- The **scheduled-task engine** to create/update/list timed and recurring jobs.
- Each scheduled run executes as a normal **governed task** — it's gated + audited at fire time under the then-current Risk Tolerance, and re-scored when it runs (so a job can't quietly become dangerous later).
No network, no shell of its own.

## Steps
1. Capture what to do, and when / how often (parse "tomorrow", "every Monday", "in an hour" to a concrete schedule).
2. Create the scheduled task with a clear name and the governed action it will run.
3. Confirm the schedule; list existing schedules on request; allow easy cancel.

## Output
A scheduled task (one-off or recurring) the user can see, edit, and cancel.

## Governance notes
Creating a reminder is Low risk. A scheduled job that performs a consequential action re-asks for approval at fire time if it exceeds the tolerance ceiling — scheduling can't be used to smuggle a high-risk action past you. All runs are audited.

## Provenance
Built-in, trusted Starfish skill (authored). Uses the governed scheduled-task engine + task lifecycle.
