# Project Starfish — Project Understanding Document

> Generated 2026-06-04 from a full recursive review of the repo.
> Purpose: reference document so Claude (and Scott) have a complete mental model of this codebase.

---

## 1. What this project is

**Project Starfish** — Scott's fork of **Munder Difflin** (forked at v0.1.7): a local, desktop **multi-agent harness for Claude Code**. The repo is rebranded (2026-06-04): package name `project-starfish`, productName/installer artifacts, window title, splash screen ("PS / PROJECT STARFISH"), fullscreen headers, and README/SPEC/DESIGN/HIVE headers all say Project Starfish, a fork of Munder Difflin. The Office cast theme (Michael the GOD agent, Dwight) is intentionally unchanged; blog, landing site, and SEO files remain upstream's. It wraps real `claude` CLI sessions as autonomous agents that message each other, share memory, and are coordinated by a **GOD orchestrator agent** ("Michael") — all visualized as pixel-art avatars (The Office cast) working on a 2D office floor.

- **Tagline:** "The world's best agents. The world's worst paper company." (Office parody of Dunder Mifflin.)
- **Repo:** Project Starfish is the fork at `github.com/Azerax/munder-difflin` (origin); upstream `github.com/chaitanyagiri/munder-difflin` (original author: Chaitanya Giri). MIT code license; **bundled pixel art is non-commercial only** (LimeZu free license).
- **Site:** https://munderdiffl.in/ (GitHub Pages from `docs/`), with a 66-post Eleventy blog at `/blog`.
- **Stack:** Electron 32 + electron-vite, React 18, TypeScript 5.6, Pixi.js 8 (office floor), xterm.js (terminals), node-pty (real PTYs), Zustand (state), CodeMirror (file editor), localtunnel (Slack webhook).

## 2. Core architecture — two planes, one renderer

1. **Terminal plane** — main process `PtyManager` (`src/main/pty.ts`) spawns each agent as a real `node-pty` process (default command `claude`), streams bytes over per-id IPC (`pty:data:<id>`) to xterm.js views. Full read/write/resize/kill.
2. **Event plane** — Claude Code **hooks**. Each agent launches with `--settings` pointing hooks at a tiny `cth-hook` shim that POSTs hook payloads (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, …) to a Unix domain socket served by `src/main/hooks.ts`. Hooks drive avatar animation AND the autonomous loop.
3. Renderer talks to main only via a typed `window.cth` contextBridge (`src/preload/index.ts`), which also exposes sandboxed fs + git helpers.

**The autonomous loop:** on `Stop`, the hook server drains the agent's inbox and returns `{"decision":"block","reason":…}` so the agent keeps working — guarded by `stop_hook_active` to prevent infinite loops.

## 3. The Hive (multi-agent coordination layer)

On-disk layer at `<harnessHome>/hive/` — a git repo committed **only** by the Electron main process (single-committer pattern avoids `index.lock` corruption; agents never call git, they write plain files).

```
hive/
  PROTOCOL.md       agent-facing contract
  registry.json     roster (agents, roles, status, seats)
  board.md          shared blackboard (god agent is sole scribe)
  tasks.json        task ledger (kanban: todo/doing/blocked/done, dependsOn[])
  log.jsonl         append-only event log (drives UI activity feed)
  agents/<id>/
    identity.md  memory.md  inbox/  inbox/.done/  outbox/  cursor.json
```

Key rules: single-writer-per-file; one JSON file per message written atomically (temp + rename); router (main process) moves messages from sender `outbox/` → recipient `inbox/`; append-only log with per-consumer cursors.

**Message schema (FIPA-lite):** `id, conversation, in_reply_to, from, to, act (request|inform|propose|query|agree|refuse|done), subject, body, hops, requires_reply, needs_human, created_at`. Anti-livelock: only request/query/propose obligate a reply; hop cap → god escalates; idempotent via cursor.

**GOD agent ("Michael"):** privileged orchestrator, lives in Michael's office on the floor. Adjudicates cross-agent traffic, routes tasks, scribes the blackboard. Resolves routine requests autonomously; escalates only critical items (spend, destructive ops, scope changes). As of v0.1.7, **HITL is native** — no separate approval queue; escalations surface as Claude Code permission prompts in Michael's session (approvable from phone via `/remote-control`).

**Memory:** markdown-first — per-agent `memory.md` + shared blackboard. Optional semantic layer via the **MemPalace CLI** (`src/main/memory.ts`): shared palace under harnessHome, each agent's memory mined into a wing, recall via `mempalace search`/`wake-up`. Degrades silently to no-op if not installed.

**Dwight (assistant.ts):** invisible headless one-shot `claude -p` (Sonnet, 1M context) prep assistant. A global "enrich" toggle routes Michael's queued prompts through Dwight first — he gathers repo context and rewrites the prompt before forwarding.

## 4. Directory map

| Path | Contents |
|---|---|
| `src/main/` | Electron main: `index.ts` (window/IPC/quit guard), `pty.ts`, `hive.ts` (652 ln, core layer), `hooks.ts` (UDS hook server + Stop-loop), `memory.ts` (MemPalace wrapper), `config.ts` (harness config + scheduled missions), `transcript.ts` (reads `~/.claude/projects/` JSONL for real token/cost telemetry), `github.ts` (gh CLI issues + CI runs), `assistant.ts` (Dwight), `slack.ts` (Slack Events webhook, HMAC-verified, via localtunnel), `shellEnv.ts`, `fs.ts`/`git.ts` (sandboxed bridges) |
| `src/preload/` | typed `window.cth` bridge + `.d.ts` |
| `src/renderer/src/` | `App.tsx`; `components/` (~35 components: CommandCenterPanel, AgentDetailPanel, TasksKanban, ThreadsPanel, MemoryPanel, MemoryGraphPanel, OnboardingWizard, Pixel* design primitives, git/CommitGraph, …); `scene/office/` (Pixi floor: OfficeFloor, Character, Camera, pathfinding, cast, envelopes, bubbles); `store/` (Zustand); `hooks/`; `design/` (tokens.css/ts — canonical design source); `assets/` (LimeZu tilesets, Tiled maps, character sheets) |
| `blog/` | Eleventy source — 66 posts in `src/posts/`, built into `docs/blog/` by CI |
| `docs/` | GitHub Pages site (landing + built blog + media) |
| `landing-remotion/` | Remotion project rendering the landing page "how it works" clips |
| `seo/` | `SEO_METADATA.md` (keyword strategy, JSON-LD) + `BLOG_IDEAS.md` (52-post backlog; blog now at 66) |
| `tools/mapgen/` | Python scripts to build/render the Tiled office map |
| `build/` | electron-builder assets (icons, mac entitlements, notarize script, SIGNING.md) |
| `.github/workflows/` | `ci.yml` (typecheck + build, macOS), `blog.yml` (rebuild Eleventy → docs/blog), `release.yml` (tag-triggered cross-platform installers) |

## 5. Key root documents

- **README.md** — product overview, feature table, install, architecture diagrams.
- **HIVE.md** — design source of truth for the multi-agent layer (patterns: MemGPT-style memory, stigmergy, blackboard, actor mailboxes, supervisor orchestrator; locked decisions listed in §2 above).
- **SPEC.md** — original terminal/event-plane spec (note: describes an older tmux-based design; the shipped app uses node-pty directly).
- **DESIGN.md** — canonical in-app design system: SNES/Animal-Crossing pixel aesthetic, full color token tables (`cream/ink/--cth-*`), brand maroon `#6E1423` + gold `#F4D35E`.
- **REDESIGN_PLAN.md** — marketing-site redesign to a cubicle.run-style neo-brutalist warm-paper look (cream `#FFFDF7`, ink `#1B1B1B`, yellow `#FFCA54`, hard offset shadows). Applies to the **site**, not the app.
- **MEMORY_GRAPH_SPEC.md** — Phase-1 spec for the memory graph tab (authored "by Jim", renderer-only, no new IPC). Now shipped (v0.1.6).
- **CHANGELOG.md** — v0.1.0 → v0.1.7 (all releases dated June 2026).
- **RELEASE.md / SECURITY.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md** — standard project hygiene.

## 6. Feature inventory (working today, v0.1.7)

Real multi-agent terminals; hive coordination + GOD orchestrator; markdown + MemPalace memory with UI search and memory graph; Pixi office floor with pathfinding, envelopes, tool bubbles; per-agent panel (terminal, command bar, file browser/editor, git tab with commit graph); Command Center (Terminal/Floor/Memory/Activity/Tasks/Schedules tabs); per-agent **git worktree isolation**; real **token & cost telemetry** from Claude transcripts; dependency-aware **task kanban**; **scheduled missions** (recurring auto-dispatch); **GitHub issue ingestion** + **CI status watcher** (gh CLI); **threaded chat** per conversation; **Slack→queue bridge** (HMAC-verified webhook + localtunnel); desktop notifications; agent archival; onboarding wizard; signed macOS builds + Win/Linux installers.

## 7. Roadmap (from README)

Heartbeat cron (context-aware Michael check-ins); heartbeat UI in Schedules; memory reflection (bound `memory.md` growth); durable persistence (SQLite); fully hook-driven avatar movement (currently mixes real hooks with a synthetic fallback loop).

## 8. Notable facts & gotchas

- The interesting work happens in the **main process**; the renderer is a pure view over IPC.
- `npm install` postinstall runs `electron-rebuild` for node-pty's native addon (needs a C/C++ toolchain).
- `npm run typecheck` (node + web) is the CI gate; keep it green.
- New UI must derive from `DESIGN.md` tokens (`src/renderer/src/design/`).
- `docs/blog/` is **generated output** — edit `blog/src/`, not docs. CI commits the rebuild.
- Asset licensing blocks commercialization unless LimeZu assets are replaced/licensed.
- Specs are aspirational in places: SPEC.md's tmux design and parts of HIVEMD differ from shipped code; "code is the source of truth for what's built."
- Git state: local `main`, fork origin (Azerax) + upstream (chaitanyagiri); recent commits are blog standups (62→66 posts) on top of the v0.1.7 release.
- Heavy content/SEO motion: `seo/` docs treat the blog as the growth engine (long-tail "claude code multi-agent" keywords, "alternative to X" comparisons), persona-authored docs (Kevin = SEO, Jim = memory graph, Angela = blog format) — the repo itself appears to be **built and operated by its own agent hive**.

---
*File locations referenced are relative to `Project Starfish/Project Starfish/` inside the workspace folder.*
