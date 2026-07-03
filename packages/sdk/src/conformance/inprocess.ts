import type { Governance } from '../index';
import type { BoundarySet, ToolCall } from '@starfish/governance-core';
import type { ModeRunner } from './runner';

/** Wraps an in-process Governance instance as a ModeRunner. `down()` simulates engine unavailability. */
export function makeInProcessRunner(gov: Governance): ModeRunner {
  let down = false;
  return {
    name: 'in-process',
    async decide(call, boundary) {
      if (down) return { allow: false, ask: false, reason: 'fail-closed: engine down' };
      return gov.governCall(call as ToolCall, boundary as BoundarySet);
    },
    async file(dec) {
      const rec = gov.broker.file(dec as Parameters<typeof gov.broker.file>[0]);
      return { id: rec.id };
    },
    async pending() {
      return gov.broker.list().map((p) => ({ id: p.id, tool: p.tool, actor: p.actor }));
    },
    async resolve(id, verdict, by) {
      const r = gov.broker.resolve(id, verdict, by);
      return { ok: r.ok, reason: r.reason };
    },
    async down() { down = true; },
  };
}
