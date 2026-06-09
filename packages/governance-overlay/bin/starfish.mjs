#!/usr/bin/env node
// `starfish govern <pack>` — thin CLI over @starfish/governance-overlay.
// Inventories a build, vets each capability, prints the scored plan, and (with --apply) installs
// the gate: Low auto-registers, Medium+ is quarantined pending --approve. Local-only.
import { AuditLog, CapabilityLedger } from '@starfish/governance-core';
import { govern } from '@starfish/governance-overlay';
import { resolve } from 'node:path';

const [cmd, target, ...rest] = process.argv.slice(2);
if (cmd !== 'govern' || !target) {
  console.error('usage: starfish govern <pack-dir> [--apply] [--approve id1,id2]');
  process.exit(2);
}
const approve = (rest.find((a) => a.startsWith('--approve='))?.split('=')[1] ?? '').split(',').filter(Boolean);
const packDir = resolve(target);
const ledger = new CapabilityLedger(new AuditLog(resolve(packDir, '.starfish', 'audit.jsonl')));
const out = govern(packDir, ledger, { approve });
console.log(`Inventoried ${packDir}`);
console.log(`  auto-registered (Low): ${out.registered.join(', ') || '(none)'}`);
console.log(`  quarantined (needs consent): ${out.quarantined.join(', ') || '(none)'}`);
if (out.approved.length) console.log(`  approved this run: ${out.approved.join(', ')}`);
console.log(`  boundary: ${out.boundary.visibility.join(', ')}`);
console.log(`  agents injected: ${out.agents.join(', ')}`);
console.log('Quarantined capabilities cannot run until you approve them (--approve=<id>).');
