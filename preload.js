const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openLogFile: () => ipcRenderer.invoke('dialog:openLogFile'),
  readLogFile: (filePath) => ipcRenderer.invoke('file:readLogFile', filePath)
});
