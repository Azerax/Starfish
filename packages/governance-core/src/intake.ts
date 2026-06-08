// Intake routing (PADD vs COMMS) — deterministic skill / reasoning mission / new-capability.
import type { Registry } from './registry';
import type { ToolDef } from './types';
import type { TaskLedger, Task, TaskType } from './tasks';

export type IntakeRoute = 'skill' | 'reasoning' | 'new-capability';

export function intakeRoute(
  req: { tool?: string; text?: string; requestNewCapability?: boolean },
  tools: Registry<ToolDef>,
): { route: IntakeRoute; taskType: TaskType } {
  if (req.requestNewCapability) return { route: 'new-capability', taskType: 'evaluation' }; // -> Toby
  if (req.tool && tools.get(req.tool)) return { route: 'skill', taskType: 'implementation' }; // PADD / green
  return { route: 'reasoning', taskType: 'mission' };                                          // COMMS / blue
}

/** All external input becomes a task first (framework §3.2); untrusted, lands in backlog. */
export function ingestExternal(ledger: TaskLedger, source: string, text: string): Task {
  return ledger.create({
    type: 'mission',
    subject: `[${source}] ${text.slice(0, 80)}`,
    proposer: `external:${source}`,
    origin: 'external/untrusted',
  });
}
