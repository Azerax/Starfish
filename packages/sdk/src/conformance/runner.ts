// The seam every integration mode implements so one scenario pack proves all modes identically.
// Wave 1 ships the in-process runner; the sidecar and overlay runners arrive in Waves 2 and 4.
export interface RunnerDecision { allow: boolean; ask: boolean; reason: string }
export interface RunnerPending { id: string; tool: string; actor: string }
export interface ModeRunner {
  name: 'in-process' | 'sidecar' | 'overlay';
  decide(call: unknown, boundary: unknown): Promise<RunnerDecision>;
  file(dec: unknown): Promise<{ id: string }>;
  pending(): Promise<RunnerPending[]>;
  resolve(id: string, verdict: 'approve' | 'deny', by: string): Promise<{ ok: boolean; reason: string }>;
  down(): Promise<void>;   // force the mode unavailable, for the fail-closed scenario
}
