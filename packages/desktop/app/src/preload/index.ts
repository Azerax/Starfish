import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  governed: true as const,
  getBaseRoot: () => ipcRenderer.invoke('setup:getBaseRoot'),
  pickBaseDir: () => ipcRenderer.invoke('setup:pickDir'),
  setBaseRoot: (dir, operator, theme) => ipcRenderer.invoke('setup:setBaseRoot', { dir, operator, theme }),
  getCrew: () => ipcRenderer.invoke('gov:getCrew'),
  getAgentDetail: (id) => ipcRenderer.invoke('gov:getAgentDetail', id),
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
  assessDelete: (path: string, recursive?: boolean) => ipcRenderer.invoke('delete:assess', { path, recursive }),
  deleteFile: (path: string, opts?: { recursive?: boolean; approved?: boolean }) => ipcRenderer.invoke('delete:file', { path, ...opts }),
  listTrash: () => ipcRenderer.invoke('delete:trash:list'),
  restoreTrash: (id: string) => ipcRenderer.invoke('delete:trash:restore', { id }),
  purgeTrash: (id: string, confirm: true) => ipcRenderer.invoke('delete:trash:purge', { id, confirm }),
};
contextBridge.exposeInMainWorld('starfish', bridge);
