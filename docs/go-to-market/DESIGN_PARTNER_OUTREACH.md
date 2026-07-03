# Design-partner outreach (draft)

For authors who ship custom Claude skill packs / UIs. Goal: a few design partners, not a mass blast.
Lead with value to THEIR audience; keep it low-pressure; offer to do the work.

## Short note (email / DM)
Subject: governance for {their product}, without changing your stack

Hi {name},

I build Project Starfish, an open-source (Apache-2.0), deny-by-default governance layer for AI agents.
I'm reaching out because people running {their product} increasingly want trust and auditability, but
they won't re-platform to get it.

Starfish drops in front of an existing skill set with no code change to your skills: a local sidecar
gates every tool action deny-by-default, parks risky ones for human approval, and writes a tamper-evident
audit log. Your users keep your UX; governance just sits underneath. Integration is about ten minutes.

Two ways it could help you:
- Your users self-install it against your stack, or
- You bundle it and offer a "Governed by Starfish" option to your audience (one integration, your whole base).

I'd love to set it up with you hands-on and hear where it's awkward before I freeze the API. Ten-minute
call, or I can send a guide and a runnable demo. No pressure either way.

Thanks,
Scott
GitHub: github.com/Azerax/Starfish  ·  projectstarfish.ca

## Etiquette
- Personalize the first line to their actual product; no template feel.
- Ask for critique, not a favor. Offer to do the integration.
- Respect that they own their UX; Starfish is underneath, never a replacement.
- Do not overstate guarantees (see the no-warranty / scope note before any public claim).
