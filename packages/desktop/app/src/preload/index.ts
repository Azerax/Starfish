import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  governed: true as const,
  getCrew: () => ipcRenderer.invoke('gov:getCrew'),
  getDecisions: (limit?: number) => ipcRenderer.invoke('gov:getDecisions', limit),
  getAudit: (sinceSeq?: number) => ipcRenderer.invoke('gov:getAudit', sinceSeq),
  getTasks: (status?: string) => ipcRenderer.invoke('gov:getTasks', status),
  getServices: () => ipcRenderer.invoke('gov:getServices'),
  getBudgets: () => ipcRenderer.invoke('gov:getBudgets'),
  getMonitor: () => ipcRenderer.invoke('gov:getMonitor'),
  getBuffer: () => ipcRenderer.invoke('gov:getBuffer'),
  subscribe: (channel: string, cb: (p: unknown) => void) => {
    const l = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on(`gov:evt:${channel}`, l as never);
    return () => { ipcRenderer.removeListener(`gov:evt:${channel}`, l as never); };
  },
  requestAction: (req: unknown) => ipcRenderer.invoke('gov:requestAction', req),
  getOnboarding: () => ipcRenderer.invoke('onboarding:get'),
  getDefaultSkills: () => ipcRenderer.invoke('onboarding:catalog'),
  completeOnboarding: (input: unknown) => ipcRenderer.invoke('onboarding:complete', input),
  getProviders: () => ipcRenderer.invoke('provider:list'),
  getActiveProvider: () => ipcRenderer.invoke('provider:active'),
  setActiveProvider: (id: string, model?: string) => ipcRenderer.invoke('provider:setActive', { id, model }),
  setProviderKey: (id: string, key: string) => ipcRenderer.invoke('provider:setKey', { id, key }),
};
contextBridge.exposeInMainWorld('starfish', bridge);
