// Headless PEP: boundary-checked fs tools, built only on governance-core (no @starfish/desktop dep).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { containCheck, isSecretPath, type BoundarySet, type ToolCall, type ToolExecResult } from '@starfish/governance-core';

export function makeFsExecutor(opts: { projectRoot: string; boundary: BoundarySet }) {
  const toAbs = (p: string): string => (isAbsolute(p) ? resolve(p) : resolve(opts.projectRoot, p));
  return async (call: ToolCall): Promise<ToolExecResult> => {
    const input = call.input as { path?: string; content?: string };
    const p = String(input.path ?? '');
    switch (call.tool) {
      case 'fs.read': {
        if (isSecretPath(p)) return { ok: false, content: '[denied: secret path]' };   // A4: PEP re-checks secrets
        const c = containCheck(toAbs(p), 'read', opts.boundary);
        if (!c.allowed) return { ok: false, content: `[denied read: ${c.reason}]` };
        return { ok: true, content: readFileSync(toAbs(p), 'utf8') };
      }
      case 'fs.list': {
        const c = containCheck(toAbs(p), 'read', opts.boundary);
        if (!c.allowed) return { ok: false, content: `[denied list: ${c.reason}]` };
        return { ok: true, content: readdirSync(toAbs(p)).join('\n') };
      }
      case 'fs.write': {
        if (isSecretPath(p)) return { ok: false, content: '[denied: secret path]' };   // A4: PEP re-checks secrets
        const c = containCheck(toAbs(p), 'write', opts.boundary);
        if (!c.allowed) return { ok: false, content: `[denied write: ${c.reason}]` };
        mkdirSync(dirname(toAbs(p)), { recursive: true });
        writeFileSync(toAbs(p), String(input.content ?? ''));
        return { ok: true, content: `wrote ${p}` };
      }
      default:
        return { ok: false, content: `[no executor for ${call.tool}]` };
    }
  };
}
