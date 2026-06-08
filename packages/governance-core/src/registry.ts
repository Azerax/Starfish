// File-based registry with single-source-of-truth cache (R&C S-13/T-13).
import { readFileSync, existsSync } from 'node:fs';
import { sha256 } from './hash';
import { GovernanceError } from './types';

export class Registry<T> {
  private cache = new Map<string, T>();
  private hash = '';
  constructor(private file: string, private keyOf: (t: T) => string) { this.reload(); }

  reload(): void {
    if (!existsSync(this.file)) throw new GovernanceError(`registry missing: ${this.file}`);
    let raw: string;
    try { raw = readFileSync(this.file, 'utf8'); } catch { throw new GovernanceError(`registry unreadable: ${this.file}`); }
    let arr: unknown;
    try { arr = JSON.parse(raw); } catch { throw new GovernanceError(`registry corrupt: ${this.file}`); }
    if (!Array.isArray(arr)) throw new GovernanceError(`registry not an array: ${this.file}`);
    this.cache = new Map((arr as T[]).map((t) => [this.keyOf(t), t]));
    this.hash = sha256(raw);
  }

  /** Fail-closed integrity check: file must match the cached hash (catches out-of-band edits). */
  verifyIntegrity(): void {
    const raw = readFileSync(this.file, 'utf8');
    if (sha256(raw) !== this.hash) {
      throw new GovernanceError(`registry hash mismatch (out-of-band edit) — fail closed: ${this.file}`);
    }
  }

  get(id: string): T | undefined { return this.cache.get(id); }
  all(): T[] { return [...this.cache.values()]; }
  contentHash(): string { return this.hash; }
}
