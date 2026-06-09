// `starfish govern <pack>` — the product flow: inventory → vet (Toby) → score → consent →
// install (register Low, quarantine Medium+), boundary auto-scoped to the pack, Starfish agents
// injected. Idempotent: an unchanged, already-vetted capability is skipped (hash-checked);
// drift forces a re-vet. Local-only (no network egress of pack contents).
import { vet, CapabilityLedger } from '@starfish/governance-core';
import type { VettingReport, BoundarySet } from '@starfish/governance-core';
import { inventory } from './inventory';

export interface GovernOutcome {
  packDir: string;
  reports: VettingReport[];
  registered: string[];    // Low — auto-enabled
  quarantined: string[];   // Medium+ — registered-but-disabled, awaiting consent
  approved: string[];      // quarantined items the human consented to this run
  unchanged: string[];     // already vetted, hash matches — skipped
  boundary: BoundarySet;
  agents: string[];        // Starfish governance agents injected into the build
}

const STARFISH_AGENTS = ['michael', 'dwight', 'toby', 'hank', 'pam'];

export function govern(packDir: string, ledger: CapabilityLedger, opts?: { approve?: string[] }): GovernOutcome {
  const reports: VettingReport[] = [];
  const registered: string[] = [], quarantined: string[] = [], approved: string[] = [], unchanged: string[] = [];

  for (const it of inventory(packDir)) {
    if (ledger.get(it.id) && ledger.verify(it.id, it.files).ok) { unchanged.push(it.id); continue; }
    const kind = it.kind === 'skill' ? 'skill' : 'tool';
    const report = vet({ id: it.id, kind, files: it.files, provenance: it.provenance });
    reports.push(report);
    if (ledger.intake(report) === 'registered') {
      registered.push(it.id);
    } else {
      quarantined.push(it.id);
      if (opts?.approve?.includes(it.id)) { ledger.approve(it.id, 'human'); approved.push(it.id); }
    }
  }
  return {
    packDir, reports, registered, quarantined, approved, unchanged,
    boundary: { visibility: [packDir], write: [packDir] },   // build is contained to its own folder
    agents: STARFISH_AGENTS,
  };
}
