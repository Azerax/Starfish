# @starfish/desktop — host shell (ring 3)

Embeds the composed Governor (`createHost`) and exposes the live PDP daemon. This is the governed
RUNTIME the desktop GUI wraps. The visual layer — the Pixi "Bridge" scene, React command-console chrome,
the Idea-Board Canvas, redshirt casualties — is themed via `theme.ts` (the IP-safe **Fleet** pack)
and is the remaining presentation work. Agent process confinement plugs in via `runner.ts`
(`AgentRunner`); the default `WorktreeRunner` scrubs env + confines cwd, and an OS-level runner
(restricted user / container) drops in for real kernel confinement (T-25).

Build/signing of installers needs certificates — see `docs/NEEDS_SCOTT_APPROVAL.md`.
