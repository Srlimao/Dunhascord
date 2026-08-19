const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getDesktopSources: (options) => ipcRenderer.invoke('get-desktop-sources', options),
  selectDesktopSource: (sourceId) => ipcRenderer.invoke('select-desktop-source', sourceId),
  startProcessAudioCapture: (pid) => ipcRenderer.invoke('start-process-audio-capture', pid),
  stopProcessAudioCapture: () => ipcRenderer.invoke('stop-process-audio-capture'),
  onProcessAudioData: (callback) => {
    ipcRenderer.removeAllListeners('process-audio-data');
    ipcRenderer.on('process-audio-data', (event, data) => callback(data));
  }
});
