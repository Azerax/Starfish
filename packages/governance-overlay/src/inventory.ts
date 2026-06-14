// Inventory an existing skills build: each immediate subfolder is treated as one capability,
// with an optional manifest.json supplying provenance. Local-only — reads files, no network.
import { readdirSync, statSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityFile } from '@starfish/governance-core';

export interface InventoryItem {
  id: string; kind: 'skill' | 'tool' | 'mcp' | 'hook';
  files: CapabilityFile[];
  hasSymlinks: boolean;
  provenance?: { author?: string; license?: string; repo?: string };
}

function readAll(dir: string, base: string, sym: { found: boolean }): CapabilityFile[] {
  const out: CapabilityFile[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) { sym.found = true; continue; }   // never follow; flag for rejection
    if (st.isDirectory()) out.push(...readAll(p, base, sym));
    else if (st.isFile()) { try { out.push({ path: p.slice(base.length + 1), content: readFileSync(p, 'utf8') }); } catch { /* skip binary */ } }
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
    const sym = { found: false };
    const files = readAll(dir, dir, sym);
    items.push({ id: e, kind: 'skill', files, hasSymlinks: sym.found, provenance });
  }
  return items;
}
