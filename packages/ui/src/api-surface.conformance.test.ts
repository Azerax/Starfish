import { describe, it, expect } from 'vitest';
import * as ui from './index';

const FROZEN = ['httpBridge', 'WIRE', 'GovernancePanel', 'PendingList'];

describe('@starfish/ui public API surface (risk 23)', () => {
  it('keeps every frozen export present', () => {
    const keys = Object.keys(ui);
    for (const name of FROZEN) expect(keys, `missing public export: ${name}`).toContain(name);
  });
});
