// The minimal host shell — embeds the composed Governor and exposes the live PDP daemon.
// Fail-closed: loadGovernor throws on missing/corrupt config, so the host cannot start ungoverned.
// (The Electron window is ring-3 presentation, added later; this is the governed runtime it wraps.)
import { loadGovernor, boundaryForAgent, persistGovernor, type Governor, type BoundarySet } from '@starfish/governance-core';
import { PdpDaemon } from '@starfish/governance-hooks';
import { join } from 'node:path';

export interface Host { governor: Governor; daemon: PdpDaemon; persist(): void; stop(): void; }
export interface HostOptions { governanceDir: string; auditPath: string; stateDir: string; projectRoot: string; listenPath: string; }

export async function createHost(opts: HostOptions): Promise<Host> {
  const governor = loadGovernor(opts.governanceDir, opts.auditPath, { stateDir: opts.stateDir }); // throws on bad config (fail-closed boot)
  const boundaryFor = (agentId: string): BoundarySet => boundaryForAgent({
    projectRoot: opts.projectRoot,
    workspace: join(opts.projectRoot, 'agents', agentId, 'workspace'),
    agentDir: join(opts.projectRoot, 'agents', agentId),
    forbid: [opts.governanceDir, opts.auditPath, opts.stateDir],   // governance/audit/state never in an agent's reach
  });
  const daemon = new PdpDaemon(governor, boundaryFor);
  await daemon.listen(opts.listenPath);
  governor.services.register('pdp-daemon', '0.8.0');
  return { governor, daemon, persist: () => persistGovernor(governor, opts.stateDir), stop: () => daemon.close() };
}
