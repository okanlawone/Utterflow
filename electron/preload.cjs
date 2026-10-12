const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('utterflow', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  rendererReady: () => ipcRenderer.invoke('renderer:ready'),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  saveApiKey: key => ipcRenderer.invoke('settings:save-api-key', key),
  removeApiKey: () => ipcRenderer.invoke('settings:remove-api-key'),
  selectVault: () => ipcRenderer.invoke('settings:select-vault'),
  requestMicrophone: () => ipcRenderer.invoke('settings:request-mic'),
  requestInputMonitoring: () => ipcRenderer.invoke('settings:request-input'),
  refreshPermissions: () => ipcRenderer.invoke('settings:permission-refresh'),
  openPrivacy: category => ipcRenderer.invoke('settings:open-privacy', category),
  pauseHotkey: () => ipcRenderer.invoke('settings:pause-hook'),
  resumeHotkey: () => ipcRenderer.invoke('settings:resume-hook'),
  openAtLogin: enabled => ipcRenderer.invoke('settings:open-at-login', enabled),
  getQueue: () => ipcRenderer.invoke('settings:queue'),
  retryFailed: () => ipcRenderer.invoke('settings:retry'),
  openToday: () => ipcRenderer.invoke('settings:open-note'),
  revealQueue: () => ipcRenderer.invoke('settings:reveal-queue'),
  quit: () => ipcRenderer.invoke('settings:quit'),
  audioCompleted: packet => ipcRenderer.invoke('audio:completed', packet),
  audioFailed: message => ipcRenderer.invoke('audio:failed', message),
  onRecordingStart: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('recording:start', listener)
    return () => ipcRenderer.removeListener('recording:start', listener)
  },
  onRecordingStop: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('recording:stop', listener)
    return () => ipcRenderer.removeListener('recording:stop', listener)
  },
  onSettingsLoaded: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('settings:loaded', listener)
    return () => ipcRenderer.removeListener('settings:loaded', listener)
  },
  onSettingsStatus: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('settings:status', listener)
    return () => ipcRenderer.removeListener('settings:status', listener)
  },
  onQueueUpdated: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('queue:updated', listener)
    return () => ipcRenderer.removeListener('queue:updated', listener)
  },
  onRecordingComplete: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('recording:complete', listener)
    return () => ipcRenderer.removeListener('recording:complete', listener)
  },
  onOverlayState: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('overlay:state', listener)
    return () => ipcRenderer.removeListener('overlay:state', listener)
  },
})
