import { describe, it, expect } from 'vitest';
import { assertLocalRoot } from './fsroot';

describe('cloud/network FS guard (risk 46)', () => {
  it('rejects a OneDrive-synced root', () => {
    expect(() => assertLocalRoot('C:/Users/x/OneDrive/Starfish')).toThrow(/cloud-synced|network/);
  });
  it('rejects a UNC/network path', () => {
    expect(() => assertLocalRoot('\\\\server\\share\\Starfish')).toThrow();
  });
  it('allows a plain local path', () => {
    expect(() => assertLocalRoot('C:/Users/x/Starfish')).not.toThrow();
  });
  it('honors the allowCloud override', () => {
    expect(() => assertLocalRoot('C:/Users/x/OneDrive/Starfish', true)).not.toThrow();
  });
});

import { homedir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeRoot } from './fsroot';

describe('root safety guard (risk 15)', () => {
  it('rejects the filesystem root', () => { expect(() => assertSafeRoot('/')).toThrow(/refused/); });
  it('rejects a drive root', () => { expect(() => assertSafeRoot('C:\\')).toThrow(/refused/); });
  it('rejects the home directory itself', () => { expect(() => assertSafeRoot(homedir())).toThrow(/refused/); });
  it('rejects a system directory', () => { expect(() => assertSafeRoot('/etc')).toThrow(/refused/); });
  it('allows a normal project folder', () => { expect(() => assertSafeRoot(mkdtempSync(join(tmpdir(), 'sf-ok-')))).not.toThrow(); });
});
