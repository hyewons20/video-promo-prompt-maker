const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  options: () => ipcRenderer.invoke('options'),
  generate: (input) => ipcRenderer.invoke('generate', input),
  cancel: () => ipcRenderer.invoke('cancel'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  removeImage: (id) => ipcRenderer.invoke('remove-image', id),
  saveCutout: (id) => ipcRenderer.invoke('save-cutout', id),
  copy: (text) => ipcRenderer.invoke('copy', text),
  exportFile: (filename, content) => ipcRenderer.invoke('export', { filename, content }),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, delta) => cb(delta)),
});
