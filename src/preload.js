'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The renderer gets exactly the calls it needs and nothing else.
contextBridge.exposeInMainWorld('waveframe', {
  pathForFile: (file) => webUtils.getPathForFile(file),
  probeAudio: (filePath) => ipcRenderer.invoke('probe-audio', filePath),
  decodeAudio: (filePath) => ipcRenderer.invoke('decode-audio', filePath),
  chooseExportPath: (opts) => ipcRenderer.invoke('choose-export-path', opts),
  exportStart: (opts) => ipcRenderer.invoke('export-start', opts),
  exportFrame: (id, frame) => ipcRenderer.invoke('export-frame', id, frame),
  exportEnd: (id) => ipcRenderer.invoke('export-end', id),
  exportCancel: (id) => ipcRenderer.invoke('export-cancel', id),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
});
