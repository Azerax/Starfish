// Loads the default skill catalog (sourced from anthropics/skills). These are CANDIDATES ONLY —
// they confer no trust. Registration happens solely via Toby's vet -> CapabilityLedger (see govern()).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DefaultSkill {
  id: string; kind: string; category: string; summary: string;
  expectedRisk: string; plugin: string; license: string; recommended?: boolean;
}

export function defaultCatalogPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'defaults', 'default-skills.json');
}

export function loadDefaultCatalog(file: string = defaultCatalogPath()): DefaultSkill[] {
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as { sets: { plugin: string; license: string; skills: Omit<DefaultSkill, 'plugin' | 'license'>[] }[] };
  const out: DefaultSkill[] = [];
  for (const set of cfg.sets) for (const s of set.skills) out.push({ ...s, plugin: set.plugin, license: set.license });
  return out;
}
