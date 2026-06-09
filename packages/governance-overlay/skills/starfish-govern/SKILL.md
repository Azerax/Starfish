---
name: starfish-govern
description: Bring an existing skills build under Project Starfish governance. Use when the user wants to govern, secure, or add oversight to a Claude build or skill pack. Inventories capabilities, vets and risk-scores each, auto-registers low-risk ones, quarantines the rest pending consent, and installs the default-deny gate scoped to the build's folder.
---

Run the governance overlay against the target build:

1. Inventory the build's capabilities (skills, tools, MCP servers, hooks).
2. Vet each (static review, provenance, dependencies, hash-on-vet) and assign a 4-tier risk score.
3. Present the scored inventory. Auto-register Low-risk capabilities; quarantine Medium+ pending the user's explicit consent, with recommended mitigations.
4. Install the gate (registries, policies, audit, fail-closed boot, hooks) with the boundary scoped to the build's folder, and inject the Starfish governance agents.

Nothing runs that wasn't vetted and cleared. All processing is local; build contents never leave the machine.
