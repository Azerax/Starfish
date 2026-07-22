# Governance integration demo — advisory vs enforcing

Shows how an existing skill comes under Starfish governance, and — just as importantly — **what each
integration path does and does not guarantee.** Run it and you will see one skill obey a deny, one
skill ignore a deny and write the file anyway, and one skill that has no way to write at all.

## The ladder

There are three ways to bring a host under governance. They are not equivalent, and describing them
in the same words is how a governance product ends up overclaiming.

| Path | Who performs the action | What it guarantees |
|---|---|---|
| **Sidecar over HTTP** (`host-skill.mjs`) | **Your host.** It holds the file handle. | **Advisory.** `/v1/decide` returns a verdict; the host chooses to honour it. Starfish is on the other end of a socket — it can answer "no", it cannot stay your hand. |
| **SDK executor** (`host-skill-enforced.ts`) | **Starfish.** The skill has no `node:fs` import. | **Enforcing by construction.** A denied call cannot be performed because the skill has nothing to perform it with, and the boundary is re-checked at the moment of IO. Still bypassable by a host author who chooses to import `fs` directly — this is a property of how the host is *built*, not something imposed on it. |
| **Claude Code overlay** (`starfish install --claude-code --managed`) | **Claude Code**, consulting a root-owned hook. | **Not the agent's to skip.** Enforcement lives in the agent runtime and the config is root-owned with bypass disabled. This is the only path where enforcement does not depend on the host cooperating. |

Two limits apply to all three: the trusted base includes the agent runtime itself, and enforcement
stops at the seam — none of this is OS-level isolation. See **H1** in
[`ROADMAP.md`](../../ROADMAP.md) and the "what it does not claim" section of
[`SECURITY.md`](../../SECURITY.md).

## Run

```
npm install
npm run build:cli
node examples/zero-change-demo/run-demo.mjs
```

## What happens

1. `starfish embed init` provisions a governed root into a fresh temp repo.
2. `starfish serve` runs the loopback governance sidecar.
3. **Cooperative skill** — asks to write `notes.md`; deny-by-default returns `ask`, so it parks the
   decision and polls. An operator approves (proposer ≠ approver: the skill cannot self-approve) and
   it writes the file.
4. **Rogue skill** — byte-for-byte the same code with one line changed. It asks, is told no, and
   writes `rogue.md` anyway.
5. **Enforced skill** — has no `fs` import. It hands a `ToolCall` to Starfish's executor; Starfish
   performs the write after re-checking the boundary and secret-path rules.

## What the advisory path still buys you

The sidecar cannot prevent the rogue write. It does, however, **create evidence of it.** From an
actual run of this demo:

```
seq=12  ingress:fs.write   deny   rogue.md      <-- decision recorded, never approved
```

The audit says `deny` and no approval follows, yet `rogue.md` exists on disk. That discrepancy is
detectable after the fact: audit-says-denied plus file-exists is a signal a monitor can act on.
Prevention and detection are different properties, and the advisory path genuinely gives you the
second one.

**But be exact about the limit of even that.** The rogue skill was caught only because it *asked*
before disobeying. A skill that never calls `/v1/decide` at all produces **no audit record whatsoever**
— Starfish never learns the action happened. So the honest statement is:

- asks, then disobeys → **detectable**
- never asks → **invisible**

Which is the same conclusion by another road: on the advisory path, the trust boundary is the host
author, not Starfish.

## Why the rogue case is in here

Because the limitation is real, and a demo that hides it teaches the wrong thing. If the only example
is a well-behaved skill, a reader reasonably concludes the sidecar *prevents* the write. It doesn't;
it advises against it, and the well-behaved skill agreed.

This is the same discipline as the T-05 conformance test, which plants a real malicious
`.git/hooks/pre-commit` rather than asserting against a mock. A governance product that can't show you
its own edges isn't one you should trust with a boundary.

The advisory path is still worth having — most hosts are yours, you want them governed, and HTTP means
any language can participate. It is just not the same claim as enforcement, and the two should never
share a sentence.
