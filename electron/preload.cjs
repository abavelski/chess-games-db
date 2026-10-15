'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Renderer code has no Node.js or direct SQL access.
contextBridge.exposeInMainWorld('chessArchive', Object.freeze({
  openDatabase: () => ipcRenderer.invoke('archive:open'),
  getCatalog: () => ipcRenderer.invoke('archive:catalog'),
  searchGames: (filters) => ipcRenderer.invoke('archive:games', filters),
  getGame: (id) => ipcRenderer.invoke('archive:game', id),
  searchRecords: (filters) => ipcRenderer.invoke('archive:records', filters),
  getRecord: (id) => ipcRenderer.invoke('archive:record', id),
}));
