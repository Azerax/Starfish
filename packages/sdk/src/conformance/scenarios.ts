import type { ModeRunner } from './runner';

export interface ScenarioEnv {
  boundary: unknown;
  unknownCall: unknown;    // a tool that is not registered
  inWriteCall: unknown;    // an in-boundary write (should ask under deny-by-default)
  outWriteCall: unknown;   // an out-of-boundary write (should deny)
  readCall: unknown;       // an allowed read
  sampleDecision: { actor: string } & Record<string, unknown>;   // to file + resolve
}
export interface ScenarioResult { name: string; pass: boolean; detail: string }

/** The invariants every integration mode must uphold identically. */
export async function runScenarioPack(r: ModeRunner, env: ScenarioEnv): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  const chk = (name: string, pass: boolean, detail = ''): void => { out.push({ name, pass, detail }); };

  const d1 = await r.decide(env.unknownCall, env.boundary);
  chk('unknown-tool-deny', !d1.allow, d1.reason);
  const d2 = await r.decide(env.inWriteCall, env.boundary);
  chk('in-boundary-write-ask', !d2.allow && d2.ask, d2.reason);
  const d3 = await r.decide(env.outWriteCall, env.boundary);
  chk('out-of-boundary-deny', !d3.allow, d3.reason);
  const d4 = await r.decide(env.readCall, env.boundary);
  chk('allowed-read-allow', d4.allow, d4.reason);

  const rec = await r.file(env.sampleDecision);
  const wrong = await r.resolve(rec.id, 'approve', env.sampleDecision.actor);
  chk('proposer-not-approver', !wrong.ok, wrong.reason);
  const right = await r.resolve(rec.id, 'approve', 'operator');
  chk('operator-approves', right.ok, right.reason);
  const again = await r.resolve(rec.id, 'approve', 'operator');
  chk('one-shot-resolution', !again.ok, again.reason);

  await r.down();
  const d5 = await r.decide(env.inWriteCall, env.boundary);
  chk('fail-closed-when-down', !d5.allow && !d5.ask, d5.reason);
  return out;
}
