// Governed directory listing. A listing IS a read of the directory, so route it through the PDP
// (boundary-checked) and audit it. Only on allow do we actually readdir. The tool 'fs.list'
// (category 'read', pathParams ['path']) must be registered. This makes "folder X was listed by Y"
// a first-class audit event and lets Hank flag enumeration/probing.
import { readdirSync } from 'node:fs';
import type { PDP } from './pdp';
import type { ToolCall, BoundarySet } from './types';

export interface ListResult { allowed: boolean; entries?: string[]; reason: string; }

export function governedList(pdp: PDP, call: ToolCall, boundary: BoundarySet): ListResult {
  const d = pdp.decide('ingress', call, boundary);   // audited (ingress:fs.list), boundary-checked
  if (!d.allow) return { allowed: false, reason: d.reason };
  const path = typeof call.input.path === 'string' ? call.input.path : '';
  try { return { allowed: true, entries: readdirSync(path), reason: 'listed' }; }
  catch (e) { return { allowed: false, reason: `list-failed: ${(e as Error).message}` }; }
}
