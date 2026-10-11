# Course correction: the canvas is the product

2026-08-31. Scott sent his original sketch and asked how we got from "a GUI to
create containers" to "searching existing ones". Fair, and the drift was mine.

## How it drifted

1. He asked whether Foundry already does this → it does most of the *creating*.
2. He asked whether we were making anything different → I said no.
3. He said "if not, a visual dashboard with map is the way to go."
4. I read "map" as **map of what exists**. He meant the map in his drawing —
   the thing you draw *before* anything exists.

Then I compounded it: I asked "what is the map actually for?" and offered four
options that all presupposed scanning. He picked from a menu where every item
was the wrong shape. Bad question, not a bad answer.

## The actual brief, from the sketch

- **Container 1** — its own Users, Database, LLM. Fully private.
- **Shared 1** and **Shared 2** — each with its own Users and Database, but a
  **shared LLM** and a **shared Knowledge Src** drawn between them.

That's it. Boxes, things inside boxes, lines to things two boxes both use.

## Built: Container Canvas

Published as an artifact. Seeds with exactly that drawing.

- `+ Container` adds a box; select it and add Users / Database / LLM / Knowledge
- Select a component → **Share this** lifts it out onto the canvas
- While a shared component is selected, tapping containers connects/disconnects
- Everything drags; works on touch
- **What this would deploy** renders the estate/v1 spec live from the canvas

## Note on shared knowledge

His drawing shows a shared Knowledge Src, which sits against the earlier "no
shared libraries, separate DBs" decision. The canvas allows it and flags it:
a shared *LLM* is just a deployment several projects call, which is fine and
normal. A shared *store* needs document-level permission filters (preview API)
and the built-in Search tool cannot pass a user identity. The warning fires only
when a knowledge or database component is shared by more than one container, so
the decision is visible at the moment it is made rather than argued in advance.

## Where the scanner fits

Not wasted, but not the product. It answers "what is actually there" — useful
once something is deployed, and useful walking into a tenant someone else built.
The canvas is what Scott asked for from the project description onward.
Sequence: canvas first, scanner second.
