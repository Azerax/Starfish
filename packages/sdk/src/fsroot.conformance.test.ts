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
