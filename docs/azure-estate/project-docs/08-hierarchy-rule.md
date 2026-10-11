# The hierarchy rule, and the catch in it

2026-08-31. Scott: *"best practices for paths in the same directory hierarchy
require a new container."*

Right instinct, and it closes a hazard rather than documenting it. But
implementing it surfaced something that changes the advice.

## The rule

Two agents whose folders sit in the same hierarchy — one containing the other —
must not share a container. Inside one container they share a managed identity,
so the narrower agent can reach the broader index regardless of its own folder.
The nesting *looks* like a boundary while being none, which is worse than not
drawing it.

Siblings are unaffected: `/marketing/a` and `/marketing/b` are disjoint and may
share a container.

## The catch — a new container is only half the fix

Splitting a nested agent into its own container does **not** resolve the
overlap. It converts a same-container nest into a cross-container leak:
`/marketing` still contains `/marketing/spring-launch`, so Marketing's index
still physically holds Spring Launch's documents, and now those are two
different audiences.

**Azure prefix scoping has no exclusion.** There is no way to say "index
`/marketing` but not `/marketing/spring-launch`". A parent folder always
contains its children and no configuration undoes that.

So the complete fix is two moves, not one:

1. New container — its own project, identity and Entra group.
2. **The folder leaves its parent on the drive.**
   `/marketing/spring-launch` → `/spring-launch`.

Which means: **the folder layout on the drive is the access model.** If the
drive's shape does not match the intended boundaries, the drive has to be
reorganised. No amount of configuration papers over it. Better to find that at
design time than three months into a rollout.

## What the canvas does now

- Nested slices in one container **block**, with the reason stated.
- The split button does both moves: creates the container with its own group,
  relocates the path to a non-colliding sibling of the root, and stamps the
  agent card with the pending drive move — `move on drive:
  /marketing/spring-launch → /spring-launch` — which stays visible until the
  documents actually follow.
- The deploy notes count how many folders still need to move for real.
- Cross-container overlaps and same-container nests are reported separately,
  because the fixes differ: one is a wrong path, the other a wrong boundary.

## The remaining honest option

If the documents genuinely cannot move, then `/marketing` and
`/marketing/spring-launch` can only coexist for **one audience**, in one
container, and the narrower slice is focus rather than isolation. That was the
original sketch, and it is still valid — it just must not be mistaken for a
permission boundary.

The choice is therefore explicit: reorganise the drive, or accept one audience.
There is no third option, and the tool should not pretend otherwise.
