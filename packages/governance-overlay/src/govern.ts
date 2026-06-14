// `starfish govern <pack>` — inventory → vet (Toby) → score → consent → install (register Low,
// quarantine Medium+), boundary auto-scoped to the pack, Starfish agents injected. Idempotent.
import { vet, CapabilityLedger, boundaryForSkill } from '@starfish/governance-core';
import type { VettingReport, BoundarySet } from '@starfish/governance-core';
import { inventory, type InventoryItem } from './inventory';
import { loadDefaultCatalog } from './defaults';

export interface GovernOutcome {
  packDir: string; reports: VettingReport[];
  registered: string[]; quarantined: string[]; rejected: string[]; approved: string[]; unchanged: string[];
  missing?: string[]; boundaries?: Record<string, BoundarySet>; boundary: BoundarySet; agents: string[];
}

const STARFISH_AGENTS = ['michael', 'dwight', 'toby', 'hank', 'pam'];

function runIntake(items: InventoryItem[], ledger: CapabilityLedger, packDir: string, opts?: { approve?: string[]; skillsRoot?: string; forbid?: string[] }): GovernOutcome {
  const reports: VettingReport[] = [];
  const registered: string[] = [], quarantined: string[] = [], rejected: string[] = [], approved: string[] = [], unchanged: string[] = [];
  for (const it of items) {
    if (ledger.get(it.id) && ledger.verify(it.id, it.files).ok) { unchanged.push(it.id); continue; }
    const kind = it.kind === 'skill' ? 'skill' : 'tool';
    const report = vet({ id: it.id, kind, files: it.files, provenance: it.provenance, hasSymlinks: it.hasSymlinks });
    reports.push(report);
    const res = ledger.intake(report);
    if (res === 'registered') registered.push(it.id);
    else if (res === 'rejected') rejected.push(it.id);
    else { quarantined.push(it.id); if (opts?.approve?.includes(it.id)) { ledger.approve(it.id, 'human'); approved.push(it.id); } }
  }
  let boundaries: Record<string, BoundarySet> | undefined;
  if (opts?.skillsRoot) {
    boundaries = {};
    for (const id of [...registered, ...quarantined]) boundaries[id] = boundaryForSkill({ skillsRoot: opts.skillsRoot, skillId: id, forbid: opts.forbid });
  }
  return { packDir, reports, registered, quarantined, rejected, approved, unchanged, boundaries,
    boundary: { visibility: [packDir], write: [packDir] }, agents: STARFISH_AGENTS };
}

export function govern(packDir: string, ledger: CapabilityLedger, opts?: { approve?: string[]; skillsRoot?: string; forbid?: string[] }): GovernOutcome {
  return runIntake(inventory(packDir), ledger, packDir, opts);
}

// Bring ONLY the default catalog skills under governance, from a pack containing their sources.
// They are NOT exempt: each is vetted + registered through the same door. `catalog` may be passed
// in-memory (e.g. a bundled JSON) or loaded from `catalogFile`.
export function governDefaults(
  packDir: string, ledger: CapabilityLedger,
  opts?: { approve?: string[]; catalogFile?: string; catalog?: { id: string }[]; skillsRoot?: string; forbid?: string[] },
): GovernOutcome {
  const ids = new Set((opts?.catalog ?? loadDefaultCatalog(opts?.catalogFile)).map((s) => s.id));
  const all = inventory(packDir);
  const out = runIntake(all.filter((i) => ids.has(i.id)), ledger, packDir, opts);
  out.missing = [...ids].filter((id) => !all.some((i) => i.id === id));
  return out;
}
