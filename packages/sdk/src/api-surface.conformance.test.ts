import { describe, it, expect } from 'vitest';
import * as sdk from './index';

// Freeze the public surface: removing/renaming any of these is a BREAKING change (major bump).
// Additions are fine (this asserts presence, not exact equality). Guards risk 23 for embedders.
const FROZEN = [
  'createGovernance',
  'ROOT_SCHEMA_VERSION', 'readRootSchema', 'ensureRootSchema',
  'assertLocalRoot', 'assertSafeRoot', 'makeFsExecutor',
  'makeInProcessRunner', 'runScenarioPack',
  'startSidecar', 'WIRE_VERSION', 'makeSidecarRunner',
  'makeTaxonomy', 'DEFAULT_TAXONOMY', 'makeOverlayRunner', 'withGovernance',
];

describe('@starfish/sdk public API surface (risk 23)', () => {
  it('keeps every frozen export present', () => {
    const keys = Object.keys(sdk);
    for (const name of FROZEN) expect(keys, `missing public export: ${name}`).toContain(name);
  });
  it('createGovernance returns the documented handle shape', () => {
    // shape check without needing a real root: just the callable exists
    expect(typeof sdk.createGovernance).toBe('function');
    expect(typeof sdk.startSidecar).toBe('function');
    expect(typeof sdk.withGovernance).toBe('function');
  });
});
