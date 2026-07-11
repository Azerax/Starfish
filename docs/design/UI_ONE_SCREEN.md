# The one-screen rule

> **Design principle (Scott, 2026-07-10):** *"For Starfish the UI fails if it is not contained to 1 screen."* A primary screen must fit in one viewport — **nothing an operator needs to act on may live below the fold.**

## Why

Starfish is a governance control plane. If the thing that needs your attention (an approval, a denial, a risk) is a scroll away, it is effectively invisible at the moment it matters — which defeats the product. SOC/ops-dashboard research is emphatic on this: a good security dashboard "shows the right information clearly and fast… helps teams act quickly and avoid mistakes," with **single-screen situational awareness** as a core goal, and it separates **at-a-glance summary** (for the operator/CISO glance) from **granular event data** (for investigation).

## The pattern we use

1. **Dashboard = summary, not stream.** The Bridge shows the *action items* (the risk-sorted approval queue) plus **accurate at-a-glance counts** (allowed / asks / denied). It never hosts the raw, ever-growing decision feed.
2. **Detail lives in its own tab.** The full live governance-decision stream is the **Activity** screen — that's where an analyst browses history; scrolling *there* is expected and fine.
3. **Nav gives quiet access.** An **Activity** nav item with a **live dot** (stream is active) links to it. We deliberately **do not** put an alarming numeric badge on it: in a deny-by-default system routine denials are *healthy*, and badge research warns that (a) overused badges cause fatigue and (b) a count that can feel inaccurate erodes trust fast. The accurate numbers live on the dashboard summary, which is bounded and always correct for its window.
4. **Bound every list.** Any list that can grow (crew, feed) is height-capped with internal scroll so it can't push the page past one screen.

## Applying it (checklist for any new screen)
- Does the primary action fit above the fold at a typical window size? If not, move detail to a tab and leave a summary + link.
- Are the at-a-glance numbers *accurate for their window* (not a capped/misleading total)?
- Is any growing list height-capped?
- Is the nav badge *quiet* unless something genuinely needs the operator (and even then, prefer the queue over a badge)?

*Sources: cybersecurity dashboard UX ([aufaitux](https://www.aufaitux.com/blog/cybersecurity-dashboard-ui-ux-design/), [designmonks](https://www.designmonks.co/blog/10-cybersecurity-dashboard-design-examples-for-design-inspiration)); badge/activity-feed patterns ([setproduct](https://www.setproduct.com/blog/badge-ui-design), [uxpatterns.dev](https://uxpatterns.dev/patterns/social/activity-feed)).*
