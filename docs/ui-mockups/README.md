# UI Mockups — ring-3 desktop (clean-room rebuild)

Static HTML mockups of the governed desktop UI. The Theme dropdown (top bar) swaps
between the Fleet skin and a neutral Ops skin live, demonstrating the user-swappable
theme system. Images are PLACEHOLDER.

| File | Screen | Governance wiring shown |
|---|---|---|
| mockup-1-bridge.html | Bridge / Mission Control | PDP decision feed (default-deny), Token Governor, Hank monitor, hash-chained audit, crew/ServiceRegistry |
| mockup-2-missions.html | Missions / Task Lifecycle | 10-state lifecycle + failure lane, proposer≠approver gate, "no task → no tool", validation-before-completed |
| mockup-3-transporter.html | Transporter / Capability Intake (Toby) | vet() signals, risk score → quarantine, hash-on-vet, human approve/deny (the only registration path) |

These are design references only — not shipped source (they live under docs/, outside the
IP-scanned packages/ tree). The real implementation will be React components in
packages/desktop wired to the governance core.
