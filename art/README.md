# Fleet art pipeline (AtlasCloud · FLUX.2 Pro)

Generates the IP-safe **Fleet** illustration set — coherent via one fixed STYLE block + a fixed seed.

## Run
```
# needs ATLASCLOUD_API_KEY (env or .env at repo root), network, and (optional) ffmpeg on PATH
node art/generate.mjs                 # all assets in fleet-assets.json
node art/generate.mjs captain-mykel   # a subset
```
Outputs → `art/fleet/*.webp` (+ `_raw/*.png`), with `art/fleet/provenance.json` (tool/prompt/seed/date)
for the Art Provenance Ledger (R&C A-3). ~$0.03/image; the recipe paces ~60s between calls because the
rate-limit window resets on every request (polls included).

## Recipe (the three knobs that decide quality)
1. **Model** = `black-forest-labs/flux-2-pro/text-to-image` — ~80% of the quality.
2. **One fixed STYLE block + one fixed seed (29)** across the whole set — coherence, not a grab-bag.
3. **Pace ~60s** between requests.
Each prompt = `<subject lead> <STYLE block>`. FLUX.2 Pro takes no negative prompt, so the STYLE block
bans text/UI/logos in the positive prompt. Edit subject leads / STYLE in `fleet-assets.json`.

## Scope — what FLUX is and isn't for here
- ✅ **Use for:** crew portraits, bridge/transporter key art, the redshirt-casualty card — painterly,
  iconic, illustration-style assets. That's what this set covers.
- ❌ **Not for:** crisp *tileable* pixel tilesets or walk-cycle sprite sheets — FLUX outputs painterly
  images, not seamless game tiles. Those need a pixel-art model or a pixel artist (tracked in
  docs/NEEDS_SCOTT_APPROVAL.md). The Pixi "Bridge" scene tiles/sprites are NOT produced here.

## IP safety
Prompts use original officer designs and generic ranks/colors — no real-actor likenesses, no
trademarked marks/insignia. Keep it that way; the distributed build must stay IP-clean (R&C L-1).
