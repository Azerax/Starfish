// The seam every integration mode implements so one scenario pack proves all modes identically.
// Wave 0 ships the in-process runner (see inprocess.conformance.test.ts); the sidecar and overlay
// runners arrive in Waves 2 and 4.
export interface ModeRunner {
  name: 'in-process' | 'sidecar' | 'overlay';
  decide(call: unknown, boundary: unknown): Promise<{ allow: boolean; ask: boolean; reason: string }>;
  pending(): Promise<Array<{ id: string; tool: string; actor: string }>>;
  resolve(id: string, verdict: 'approve' | 'deny', by: string): Promise<{ ok: boolean; reason: string }>;
  down(): Promise<void>;   // force the transport unavailable, for the fail-closed scenario
}
