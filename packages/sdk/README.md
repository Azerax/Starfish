# @starfish/sdk

Headless embedding surface for **Starfish External** - drop deny-by-default governance into a Node host
(a CLI skill runner or a custom UI backend) with no Electron and no desktop dependency.

## Install
Provisioned by `starfish embed` (recommended) or, for Node hosts, `npm i @starfish/sdk`.

## Use
```ts
import { createGovernance } from '@starfish/sdk';

const starfish = createGovernance({
  root: '/path/to/governed-root',            // contains governance/, audit.jsonl, state/
  keyResolver: () => process.env.ANTHROPIC_API_KEY,   // keys stay host-side, never stored by the SDK
});

// (a) gate your own action, deny-by-default + fail-closed:
const d = starfish.governCall(
  { agentId: 'worker', tool: 'fs.write', input: { path: '/path/to/governed-root/notes.md' } },
  { visibility: ['/path/to/governed-root'], write: ['/path/to/governed-root'] },
);
if (d.allow) { /* proceed */ } else if (d.ask) { /* wait for operator approval via starfish.broker */ }

// (b) run a governed agent end to end (PDP gates each tool; asks park on the broker for approval):
const result = await starfish.runGovernedSkill({
  agentId: 'worker',
  brief: 'create notes.md with three facts',
  boundary: { visibility: ['/path/to/governed-root'], write: ['/path/to/governed-root'] },
});
```

Invariants that always hold: deny-by-default, fail-closed (no decision => deny), proposer != approver
(agents cannot self-approve; approvals go through `starfish.broker`), a hash-chained audit log in the
governed root, and a non-lowerable system-risk floor. Roots on cloud-synced/network filesystems and
system/home/root directories are refused.

The runnable version of this example lives in `src/examples.conformance.test.ts` (run by the test gate,
so this snippet cannot drift).
