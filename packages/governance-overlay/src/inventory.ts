// Inventory an existing skills build: each immediate subfolder is treated as one capability,
// with an optional manifest.json supplying provenance. Local-only — reads files, no network.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityFile } from '@starfish/governance-core';

export interface InventoryItem {
  id: string; kind: 'skill' | 'tool' | 'mcp' | 'hook';
  files: CapabilityFile[];
  provenance?: { author?: string; license?: string; repo?: string };
}

function readAll(dir: string, base: string): CapabilityFile[] {
  const out: CapabilityFile[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...readAll(p, base));
    else { try { out.push({ path: p.slice(base.length + 1), content: readFileSync(p, 'utf8') }); } catch { /* skip binary */ } }
  }
  return out;
}

export function inventory(packDir: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const e of readdirSync(packDir)) {
    const dir = join(packDir, e);
    if (!statSync(dir).isDirectory()) continue;
    let provenance: InventoryItem['provenance'];
    const man = join(dir, 'manifest.json');
    if (existsSync(man)) { try { provenance = JSON.parse(readFileSync(man, 'utf8')); } catch { /* ignore */ } }
    items.push({ id: e, kind: 'skill', files: readAll(dir, dir), provenance });
  }
  return items;
}
