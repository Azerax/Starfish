// Shared helpers for conformance tests / host self-checks. Builds a minimal governed root and scripts
// a model transport. Not part of the public API (not re-exported from index).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall } from '@starfish/governance-core';

export type Pol = { id: string; subject: string; action: string; resource: string; effect: 'allow' | 'ask' | 'deny' };
export const P_READ: Pol = { id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' };
export const P_WRITE_ALLOW: Pol = { id: 'p-write', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'allow' };

export function makeGovernedRoot(policies: Pol[]): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-root-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'audit.jsonl'), '');
  writeFileSync(join(root, 'governance', 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' },
  ]));
  writeFileSync(join(root, 'governance', 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(root, 'governance', 'policies.json'), JSON.stringify(policies));
  return root;
}
export const tcall = (tool: string, input: Record<string, unknown>): ToolCall => ({ agentId: 'worker', tool, input });
export function scripted(responses: string[]) {
  let i = 0;
  return async () => ({ status: 200, ok: true, text: async () => responses[Math.min(i++, responses.length - 1)] });
}
export const toolUseWrite = (path: string, content: string): string =>
  JSON.stringify({ content: [{ type: 'tool_use', id: 't1', name: 'fs__write', input: { path, content } }], usage: { input_tokens: 1, output_tokens: 1 } });
export const finalText = (t: string): string =>
  JSON.stringify({ content: [{ type: 'text', text: t }], usage: { input_tokens: 1, output_tokens: 0 } });
