'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The stored theme comes in on the command line (see main.js) so the
// renderer can read it synchronously, before it paints anything.
const themeArg = process.argv.find((arg) => arg.startsWith('--wf-theme='));

// The renderer gets exactly the calls it needs and nothing else.
contextBridge.exposeInMainWorld('wave', {
  initialTheme: themeArg ? themeArg.slice('--wf-theme='.length) : 'system',
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probeAudio: (filePath) => ipcRenderer.invoke('probe-audio', filePath),
  decodeAudio: (filePath, expectedSeconds) => ipcRenderer.invoke('decode-audio', filePath, expectedSeconds),
  onAnalysisProgress: (callback) => {
    ipcRenderer.on('analysis-progress', (event, state) => callback(state));
  },
  chooseExportPath: (opts) => ipcRenderer.invoke('choose-export-path', opts),
  exportStart: (opts) => ipcRenderer.invoke('export-start', opts),
  exportFrame: (id, frame) => ipcRenderer.invoke('export-frame', id, frame),
  exportEnd: (id) => ipcRenderer.invoke('export-end', id),
  exportCancel: (id) => ipcRenderer.invoke('export-cancel', id),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  appInfo: () => ipcRenderer.invoke('app-info'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  onUpdateState: (callback) => {
    ipcRenderer.on('update-state', (event, state) => callback(state));
  },
});
