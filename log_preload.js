const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logAPI', {
  getRuntimeLogs: () => ipcRenderer.invoke('get-runtime-logs'),
  onRuntimeLog: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('runtime-log', (_event, payload) => handler(payload));
  },
});

