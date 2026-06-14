# Needs Scott's Approval / Review (running list)

Items I cannot decide autonomously (legal, money, irreversible, or environment ops). I keep
building around these; review at your convenience.

## Legal / IP (⚖ — before any paid release)
- Trek-IP-free distribution sign-off (LCARS-inspired-not-replica, original officers, no marks). [R&C L-1/L-1a/L-1b]
- Product-name trademark clearance for the sellable product. [R&C L-5]
- EULA / ToS for the overlay (processes third-party builds; "vetting is assistive, not a guarantee"). [R&C L-6/L-7]
- AI-art generator commercial-license terms + output-ownership confirmation. [R&C A-1/A-2]

## Money (💲)
- AI image generation for the Fleet pixel-art tileset + sprites (Phase 9 assets). Needs a chosen tool + spend approval.
- Code-signing certificates for packaged installers (Win/macOS). 

## Environment / ops (you decide the target)
- OS-level agent sandboxing (T-25): true confinement needs a container/restricted-user setup
  (Docker is on your PATH). The sandbox SEAM is built; provisioning real confinement is your infra call.
- Running the real Electron GUI: the host/governed runtime is built and tested headless; standing up
  the actual Pixi/React window is presentation work best done where a display exists.

## Git / housekeeping (non-urgent)
- UNCOMMITTED (root cause found): a stale `.git/index.lock` (from an interrupted git_add) is blocking
  ALL commits — MCP or native — and the sandbox can't delete it (mount blocks unlink). Also the git MCP
  tools are not exposed to the agent session right now. **Fix (PowerShell):**
      cd C:\Users\swhol\Documents\Github\Starfish
      Remove-Item .git\index.lock
      git add -A; git commit -m "Phases 7.5-9 + art pipeline"
  That lands all 31 pending paths (verified green, backed up). Last commit: 427a357.
- Stray `C:\Users\swhol\.git` (from the earlier accident) can be removed: `Remove-Item -Recurse -Force C:\Users\swhol\.git` (history only, no files).
- Superseded OneDrive copy at `Project Starfish/starfish/` can be deleted; canonical repo is `Documents\Github\Starfish`.

## Art pipeline (ready to run — needs key + spend)
- The Fleet illustration pipeline is built (`art/generate.mjs`, `art/fleet-assets.json`, IP-safe prompts,
  FLUX.2 Pro recipe, fixed seed, 60s pacing, ffmpeg→webp). To generate: put `ATLASCLOUD_API_KEY` in `.env`
  (or env) on a machine with network + ffmpeg and run `npm run art:fleet`. ~9 assets × ~$0.03 ≈ $0.30 (spend, pre-approved by Scott — just needs the key/runtime; I can't reach api.atlascloud.ai from here).
- **Pixel assets gap:** FLUX.2 Pro is painterly, not tileable-pixel. The Pixi "Bridge" tileset + walk-cycle
  sprite sheets need a pixel-art model or a pixel artist — decide the approach. (Portraits/key-art via FLUX are covered.)
