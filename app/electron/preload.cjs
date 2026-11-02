const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sobesych', {
  getConfig: () => ipcRenderer.invoke('app:config'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  setUpdateBusy: value => ipcRenderer.invoke('update:busy', value === true),
  onUpdateState: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  saveState: value => ipcRenderer.invoke('state:save', value),
  savePracticeLibraries: value => ipcRenderer.invoke('practice-libraries:save', value),
  saveContextDocuments: value => ipcRenderer.invoke('context:save', value),
  exportDiagram: source => ipcRenderer.invoke('diagram:export', source),
  setCaptureProtection: enabled => ipcRenderer.invoke('privacy:set', enabled),
  assist: value => ipcRenderer.invoke('provider:assist', value),
  traceAnswer: value => ipcRenderer.invoke('answer:trace', value),
  onAnswerDelta: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('provider:delta', listener)
    return () => ipcRenderer.removeListener('provider:delta', listener)
  },
  transcribe: value => ipcRenderer.invoke('provider:transcribe', value),
  warmLocalTranscription: () => ipcRenderer.invoke('local-stt:warm'),
  releaseLocalTranscription: () => ipcRenderer.invoke('local-stt:release'),
  installGpuSpeech: () => ipcRenderer.invoke('local-stt:gpu-install'),
  cancelGpuSpeech: () => ipcRenderer.invoke('local-stt:gpu-cancel'),
  getAudioSourceId: () => ipcRenderer.invoke('audio:source'),
  traceAudioCapture: value => ipcRenderer.invoke('audio:trace', value),
  models: () => ipcRenderer.invoke('provider:models'),
  cancelRequests: requestId => ipcRenderer.invoke('provider:cancel', { requestId }),
  captureScreen: () => ipcRenderer.invoke('screen:capture'),
  selectScreenRegion: () => ipcRenderer.invoke('screen:select-region'),
  setOverlayMode: enabled => ipcRenderer.invoke('overlay:set', enabled),
  onOverlayAction: callback => {
    const listener = (_event, action, enabled) => callback({ action, enabled })
    ipcRenderer.on('overlay:action', listener)
    return () => ipcRenderer.removeListener('overlay:action', listener)
  },
  exportCall: value => ipcRenderer.invoke('call:export', value),
  openLogs: () => ipcRenderer.invoke('app:logs'),
  reportError: message => ipcRenderer.invoke('app:error', String(message)),
})
