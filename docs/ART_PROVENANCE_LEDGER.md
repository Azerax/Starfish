# Art Provenance Ledger

> Every shipped art asset records its generation tool, prompt, date, license terms at generation
> time, and the human reviewer who confirmed no resemblance to protected work (R&C A-1/A-2/A-3).

## Pipeline of record
- Tool: **FLUX.2 Pro** on AtlasCloud (`black-forest-labs/flux-2-pro/text-to-image`), fixed seed 29.
- Generator: `art/generate.mjs`; prompt set: `art/fleet-assets.json`; outputs: `art/fleet/` with
  per-asset `art/fleet/provenance.json` (auto-written each run).
- Cost: ~$0.03/image. License terms of the generator's output must be confirmed before commercial
  release (R&C A-1 — pending, see NEEDS_SCOTT_APPROVAL.md).

## Assets (filled when generated; reviewer confirms no resemblance)
| Asset | Tool | Prompt (summary) | Date | License terms | Reviewer | Resemblance check |
|---|---|---|---|---|---|---|
| _(run art/generate.mjs to populate from art/fleet/provenance.json)_ | | | | | | |
