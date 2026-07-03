// Governed-root schema stamp. Fail-closed: refuse a root newer than we understand; migrate older ones.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const ROOT_SCHEMA_VERSION = 1;
const schemaFile = (root: string): string => join(root, 'schema.json');

export function readRootSchema(root: string): number | undefined {
  try { return (JSON.parse(readFileSync(schemaFile(root), 'utf8')) as { version?: number }).version; }
  catch { return undefined; }
}

/** Stamp if absent; migrate if older; throw (fail-closed) if newer than supported. */
export function ensureRootSchema(root: string): void {
  const v = readRootSchema(root);
  if (v === undefined) {
    const f = schemaFile(root);
    if (!existsSync(dirname(f))) mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ version: ROOT_SCHEMA_VERSION }, null, 2));
    return;
  }
  if (v > ROOT_SCHEMA_VERSION) {
    throw new Error(`governed root schema v${v} > supported v${ROOT_SCHEMA_VERSION}; upgrade Starfish (fail-closed)`);
  }
  if (v < ROOT_SCHEMA_VERSION) migrateRoot(root, v);
}

/** Per-version migrations; must be idempotent. Re-stamp at the end. */
function migrateRoot(root: string, _from: number): void {
  writeFileSync(schemaFile(root), JSON.stringify({ version: ROOT_SCHEMA_VERSION }, null, 2));
}
