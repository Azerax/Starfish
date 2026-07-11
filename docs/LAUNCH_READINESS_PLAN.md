# Starfish 1.0 launch readiness — "the governed OpenClaw"

> **Date:** 2026-07-10 · **Status:** research + plan for review.
> **Goal (Scott):** a major release that is **as functional as OpenClaw was at launch — minus all the security issues.** Two named pillars: (1) UI finished, (2) a set of 10 skills covering most people's use cases. This doc confirms those and researches what else a launch of this size needs.

---

## 1. The benchmark — what OpenClaw is, and why it's our foil

OpenClaw (Peter Steinberger; Nov 2025 as Warelay → Moltbot → OpenClaw) is the most-starred self-hosted AI agent on GitHub (~380k stars / ~80k forks by mid-2026). It runs **locally**, connects an LLM directly to your **files, OS, messaging apps, and the internet**, keeps **persistent memory across sessions**, works tasks in the background, and is driven from a **chat interface** (Signal/Telegram/Discord/WhatsApp) with a **skills marketplace** (ClawHub). That functional surface is the bar.

It also launched into a security disaster that reads like Starfish's problem statement: **ClawBleed** (CVE-2026-25253 — one clicked link → full RCE; 40k+ instances exposed, 63% exploitable), **1,184 malicious skills** on ClawHub, **492 MCP servers exposed with zero auth**, **~37% of agent skills carrying a flaw** (Snyk ToxicSkills), and shadow **one-line installs** with no approval or SOC visibility. Every one of these maps to a Starfish control (deny-by-default, vetting-is-the-only-door, no ungoverned egress, hash-chained audit, governed install). **Security isn't our disclaimer — it's our headline feature**, and OpenClaw's incident list is the proof-by-contrast.

**Positioning line:** *"Everything OpenClaw does. None of the ways it gets you breached."*

## 2. Pillar 1 — UI finished (in progress)

Direction is chosen (D5 Split Cockpit desktop + D1 Approval-Inbox embeddable; calm token default; Fleet as an optional skin). Remaining to "finished" for launch:
- Finish the desktop **Bridge (D5)** rebuild + light/dark toggle (started).
- A **chat-first entry** (see §4.1 — this is the OpenClaw-parity gap).
- **Onboarding** first-run polish for non-technical users (spare-machine / experimenting audience).
- **Risk Tolerance** setting UI + the **risk descriptor** surfacing (Clear→Forbidden) in the approval cards.
- Screenshot-quality pass: empty states, loading, error, dark mode.

## 3. Pillar 2 — 10 skills that cover most people (proposed)

Chosen to match what OpenClaw users actually do (personal-assistant + prosumer tasks), leaning on the built-in trusted seed (`STARFISH built-in skills` spec) and the import-and-Arena catalog:

1. **Documents** — write/edit Word docs (reports, letters, resumes). *(docx)*
2. **Spreadsheets** — budgets, trackers, clean messy data. *(xlsx)*
3. **PDF toolkit** — fill forms, merge/split, extract, sign. *(pdf)*
4. **Presentations** — build decks from notes. *(pptx)*
5. **Web research + brief** — governed fetch across sources → a cited summary.
6. **File organizer** — sort, rename, dedupe, find; governed soft-delete via the Custodian.
7. **Email & message drafting** — compose/reply **drafts** (human sends — fits governance).
8. **Meeting notes** — transcript → summary + action items (+ optional tasks).
9. **Personal knowledge** — capture and retrieve from governed memory ("what did I decide about X?").
10. **Scheduling & reminders** — recurring jobs and reminders via the scheduled-task engine.

All ship trusted-by-provenance or vetted-on-intake; none run ungoverned. (Alternates to swap per audience: a coding helper, or image generation.)

## 4. What else a launch this size needs (the research answer)

### 4.1 Functional parity gaps vs OpenClaw (the "you might be missing" list)
- **Chat-first / conversational surface.** OpenClaw's core UX is *you talk to it.* Starfish is desktop-GUI-first. Launch needs a **conversation entry** (the COMM screen, elevated to a first-class chat) and, ideally, at least one **messaging connector** (Telegram/Signal/Discord) so people can reach their governed agent the way they reach OpenClaw — the difference being every action is still gated + audited.
- **Persistent memory, visible.** We have the governed memory architecture; launch should *surface* it ("remembers across sessions") since that's an OpenClaw headline.
- **A vetted skill catalog = our answer to ClawHub.** OpenClaw's marketplace is the malware vector. Ship a small, **curated, signed** catalog + `starfish govern` for anything else — and say so loudly.
- **Background/async work.** OpenClaw "works while you're away." Our scheduled-tasks + task lifecycle cover this; make it visible.

### 4.2 Go-to-market assets (Scott flagged screenshots)
- **Screenshots** of the finished UI (Bridge, approval card, onboarding, Risk Tolerance) — for the README, the website, and git release notes. *Blocked on Pillar 1.*
- **A 60–90s demo video / GIF** — the `examples/zero-change-demo` is the spine ("watch it deny an exfiltration in real time").
- **Website refresh** (`site/`, projectstarfish.ca) — new positioning, screenshots, skills showcase, a **"Starfish vs OpenClaw"** comparison, and a **security page** ("how we'd have stopped ClawBleed / malicious skills / shadow installs").
- **README with hero screenshot + 3-line pitch + install.**

### 4.3 Adoption / onboarding
- **Frictionless but governed install** (npm + GitHub done; add a signed desktop installer + the double-click launcher). Counter-message to OpenClaw's dangerous one-liner: *easy AND safe.*
- **Bring-your-own-key** model/provider setup (exists) — smooth it.
- **First-run wizard** that gets a non-technical user to a first successful, governed task in <5 minutes.

### 4.4 Trust & release mechanics (mostly "Needs Scott")
- **1.0 cut:** the v0.13→v0.22 candidate is built locally but **unpushed/unpublished** — push, tag, npm publish with provenance/SBOM (needs his creds/NPM_TOKEN).
- **Signed builds** + self-integrity (already designed).
- **Security page + responsible-disclosure policy** (SECURITY.md) — table stakes given the category.
- **Legal:** finalize TRADEMARK/COMMERCIAL (draft, needs counsel); confirm the name is clear; IP-safe theme by default (Fleet off).
- **Telemetry stance:** local-first, no data egress by default — a selling point vs shadow AI; state it explicitly.
- **Community:** CONTRIBUTING (exists), issue/PR templates, a support channel.

## 5. Prioritized path to launch

| Phase | Work | Gates |
|---|---|---|
| **L1 — Finish the product surface** | Bridge D5 + chat-first COMM + onboarding polish + Risk Tolerance UI + risk descriptors | UI screenshot-ready in light/dark |
| **L2 — The 10 skills** | Import + Arena-vet + provenance-sign the §3 set; wire into the Skill Library | each passes the Arena; runs governed end-to-end |
| **L3 — Parity + proof** | one messaging connector; surface memory + background tasks; the zero-change demo video | a non-dev completes a real task in <5 min |
| **L4 — GTM assets** | screenshots, README hero, website refresh, Starfish-vs-OpenClaw + security pages | site live with screenshots |
| **L5 — Release mechanics** | push, tag v1.0, npm publish w/ provenance + SBOM, signed installer, SECURITY.md, legal sign-off | 1.0 published; `npm run ci` green |

## 6. Needs Scott (decisions that gate the plan)
- **Chat-first + messaging connector:** in scope for 1.0 (recommended for OpenClaw parity), or fast-follow?
- **The 10 skills:** confirm the §3 set or swap (coding helper / image gen)?
- **Launch surface:** desktop app first, embeddable/CLI first, or both?
- **The OpenClaw comparison:** do we name OpenClaw directly in marketing (strong, a little spicy) or imply it ("ungoverned agents")?
- **Release mechanics** remain on the standing "Needs Scott" list (push/publish/provenance/legal).

---

*Sources: OpenClaw overview + adoption ([Wikipedia](https://en.wikipedia.org/wiki/OpenClaw), [MindStudio](https://www.mindstudio.ai/blog/what-is-openclaw-ai-agent)); security incidents ([cyberdesserts: OpenClaw skills](https://blog.cyberdesserts.com/openclaw-malicious-skills-security/), [Stormshield](https://www.stormshield.com/news/openclaw-claude-risks-and-retrospectives/), [cyberdesserts: agent risks](https://blog.cyberdesserts.com/ai-agent-security-risks/)). Cross-refs: `docs/GA_CHECKLIST.md`, `docs/STARFISH_EXTERNAL_POSITIONING.md`, the built-in-skills spec, `docs/design/UI_DIRECTIONS.md`, `site/`.*
