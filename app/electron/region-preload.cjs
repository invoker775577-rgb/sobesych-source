const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('region', {
  complete: bounds => ipcRenderer.send('region:complete', bounds),
  cancel: () => ipcRenderer.send('region:cancel'),
})
