import { contextBridge, ipcRenderer } from 'electron';
// Minimal surface for the splash window: a single user-initiated "enter the bridge" signal.
contextBridge.exposeInMainWorld('splashApi', { enter: () => ipcRenderer.send('splash:enter') });
