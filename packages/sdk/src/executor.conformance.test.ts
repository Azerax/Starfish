import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BoundarySet, ToolCall } from '@starfish/governance-core';
import { makeFsExecutor } from './executor';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-exec-'));
  const boundary: BoundarySet = { visibility: [dir], write: [dir] };
  return { dir, exec: makeFsExecutor({ projectRoot: dir, boundary }) };
}
const call = (tool: string, input: Record<string, unknown>): ToolCall => ({ agentId: 'worker', tool, input });

describe('headless fs executor (PEP)', () => {
  it('writes then reads within the boundary', async () => {
    const { dir, exec } = setup();
    const w = await exec(call('fs.write', { path: join(dir, 'a.txt'), content: 'hi' }));
    expect(w.ok).toBe(true);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hi');
    const r = await exec(call('fs.read', { path: join(dir, 'a.txt') }));
    expect(r.ok).toBe(true); expect(r.content).toBe('hi');
  });
  it('lists within the boundary', async () => {
    const { dir, exec } = setup();
    await exec(call('fs.write', { path: join(dir, 'b.txt'), content: 'x' }));
    const l = await exec(call('fs.list', { path: dir }));
    expect(l.ok).toBe(true); expect(l.content).toContain('b.txt');
  });
  it('denies a write outside the boundary', async () => {
    const { dir, exec } = setup();
    const w = await exec(call('fs.write', { path: resolve(dir, '..', 'evil.txt'), content: 'no' }));
    expect(w.ok).toBe(false); expect(w.content).toMatch(/denied/);
  });
  it('denies reads and writes of secret paths (A4)', async () => {
    const { dir, exec } = setup();
    const w = await exec(call('fs.write', { path: join(dir, '.env'), content: 'K=v' }));
    expect(w.ok).toBe(false); expect(w.content).toMatch(/secret/);
    const r = await exec(call('fs.read', { path: join(dir, '.env') }));
    expect(r.ok).toBe(false); expect(r.content).toMatch(/secret/);
  });
  it('has no executor for an unknown tool', async () => {
    const { exec } = setup();
    const r = await exec(call('mystery', {}));
    expect(r.ok).toBe(false);
  });
});
