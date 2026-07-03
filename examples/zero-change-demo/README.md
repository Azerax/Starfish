# Zero-change governance demo

Shows the Starfish External wedge: put governance in front of an existing skill without changing the
skill's code. `host-skill.mjs` has no Starfish import - it just routes its file-write through the local
sidecar over HTTP.

## Run
```
npm install
npm run build:cli
node examples/zero-change-demo/run-demo.mjs
```

## What happens
1. `starfish embed init` provisions a governed root into a fresh temp repo.
2. `starfish serve` runs the loopback governance sidecar.
3. The unmodified host skill asks to write `notes.md`; deny-by-default returns `ask`, so it parks the
   decision and polls for the outcome.
4. An operator approves (proposer != approver: the skill cannot self-approve).
5. The skill proceeds and writes the file; every step is in the hash-chained audit log.

Change the operator to deny (or never approve) and the file is never written - governance held.
