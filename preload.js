const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  options: () => ipcRenderer.invoke('options'),
  saveKey: (key) => ipcRenderer.invoke('save-key', key),
  generate: (input) => ipcRenderer.invoke('generate', input),
  cancel: () => ipcRenderer.invoke('cancel'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  exportFile: (filename, content) => ipcRenderer.invoke('export', { filename, content }),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, delta) => cb(delta)),
});
