const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openLogFile: () => ipcRenderer.invoke('dialog:openLogFile'),
  readLogFile: (filePath) => ipcRenderer.invoke('file:readLogFile', filePath),
  watchLogFile: (filePath) => ipcRenderer.invoke('file:watchLogFile', filePath),
  unwatchLogFile: (filePath) => ipcRenderer.invoke('file:unwatchLogFile', filePath),
  onLogFileChanged: (callback) => {
    ipcRenderer.on('file:log-changed', (event, data) => callback(data));
  }
});
