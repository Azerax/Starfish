import { contextBridge, ipcRenderer } from 'electron';

// F28/F29 — the capability token lives ONLY in this preload closure. Main injects it via
// additionalArguments; the page never sees it. The preload attaches it to privileged calls, so a
// foreign frame/webview/context that never ran this preload cannot present it. (Code running in OUR
// verified renderer can call the bridge — which is why the renderer-integrity guard + CSP + sandbox,
// enforced in main, ensure only our shipped code runs here.)
const IPC_TOKEN = (process.argv.find((a) => a.startsWith('--sf-ipc-token=')) ?? '').slice('--sf-ipc-token='.length);

const bridge = {
  governed: true as const,
  getBaseRoot: () => ipcRenderer.invoke('setup:getBaseRoot'),
  pickBaseDir: () => ipcRenderer.invoke('setup:pickDir'),
  setBaseRoot: (dir: string, operator?: string, theme?: string) => ipcRenderer.invoke('setup:setBaseRoot', { dir, operator, theme }),
  getCrew: () => ipcRenderer.invoke('gov:getCrew'),
  getAgentDetail: (id: string) => ipcRenderer.invoke('gov:getAgentDetail', id),
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
  requestAction: (req: Record<string, unknown>) => ipcRenderer.invoke('gov:requestAction', { ...req, token: IPC_TOKEN }),
  getOnboarding: () => ipcRenderer.invoke('onboarding:get'),
  getDefaultSkills: () => ipcRenderer.invoke('onboarding:catalog'),
  completeOnboarding: (input: unknown) => ipcRenderer.invoke('onboarding:complete', input),
  getProviders: () => ipcRenderer.invoke('provider:list'),
  getActiveProvider: () => ipcRenderer.invoke('provider:active'),
  setActiveProvider: (id: string, model?: string) => ipcRenderer.invoke('provider:setActive', { id, model }),
  setProviderKey: (id: string, key: string) => ipcRenderer.invoke('provider:setKey', { id, key }),
  assessDelete: (path: string, recursive?: boolean) => ipcRenderer.invoke('delete:assess', { path, recursive }),
  deleteFile: (path: string, opts?: { recursive?: boolean; approved?: boolean }) => ipcRenderer.invoke('delete:file', { path, ...opts, token: IPC_TOKEN }),
  listTrash: () => ipcRenderer.invoke('delete:trash:list'),
  restoreTrash: (id: string) => ipcRenderer.invoke('delete:trash:restore', { id }),
  purgeTrash: (id: string, confirm: true) => ipcRenderer.invoke('delete:trash:purge', { id, confirm, token: IPC_TOKEN }),
  getReadiness: () => ipcRenderer.invoke('gov:getReadiness'),
  getPrivilege: () => ipcRenderer.invoke('sys:getPrivilege'),
  getRiskTolerance: () => ipcRenderer.invoke('sys:getRiskTolerance'),
  setRiskTolerance: (next: 'low' | 'medium', confirmed?: boolean) => ipcRenderer.invoke('sys:setRiskTolerance', { next, confirmed, token: IPC_TOKEN }),
  getCost: () => ipcRenderer.invoke('provider:getCost'),
  setCost: (mode: string, budgetUsd?: number) => ipcRenderer.invoke('provider:setCost', { mode, budgetUsd }),
};
contextBridge.exposeInMainWorld('starfish', bridge);
