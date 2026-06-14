// Service Registry (framework registry hierarchy) — "what is running right now".
// Main-process subsystems register on start and heartbeat on a timer.
import type { AuditLog } from './audit';
export interface ServiceInfo { id: string; version: string; status: 'up' | 'down'; lastHeartbeat: number; }

export class ServiceRegistry {
  private svc = new Map<string, ServiceInfo>();
  constructor(private audit?: AuditLog) {}
  register(id: string, version: string): void {
    this.svc.set(id, { id, version, status: 'up', lastHeartbeat: Date.now() });
    this.audit?.append({ actor: 'system', domain: 'system', action: 'service:register', target: id, reason: version });
  }
  heartbeat(id: string): void { const s = this.svc.get(id); if (s) { s.lastHeartbeat = Date.now(); s.status = 'up'; } }
  markDown(id: string): void { const s = this.svc.get(id); if (s) s.status = 'down'; }
  status(staleMs = 30000): ServiceInfo[] {
    const now = Date.now();
    return [...this.svc.values()].map((s) => ({ ...s, status: now - s.lastHeartbeat > staleMs ? 'down' : s.status }));
  }
  snapshot(): ServiceInfo[] { return [...this.svc.values()]; }
  restore(arr: ServiceInfo[]): void { this.svc = new Map(arr.map((s) => [s.id, s])); }
}
