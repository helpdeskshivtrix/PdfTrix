const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__SHIVTRIX_DESKTOP__', {
  platform: process.platform,
  onOpenFile(cb) {
    ipcRenderer.on('open-file', (_e, f) => cb(f));
    ipcRenderer.send('renderer-ready');
  }
});
