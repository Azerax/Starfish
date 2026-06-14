import type { GovernanceBridge } from './types';
import { mockBridge } from './mockBridge';

// The real bridge is injected by the Electron preload as window.starfish. Outside Electron
// (web preview) we fall back to the mock. Either way the UI is "governed" by contract.
export function getBridge(): GovernanceBridge {
  return (typeof window !== 'undefined' && window.starfish) ? window.starfish : mockBridge;
}
