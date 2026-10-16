'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Renderer code has no Node.js or direct SQL access.
contextBridge.exposeInMainWorld('chessArchive', Object.freeze({
  openDatabase: () => ipcRenderer.invoke('archive:open'),
  bookContents: (bookId) => ipcRenderer.invoke('archive:book', bookId),
  getCatalog: () => ipcRenderer.invoke('archive:catalog'),
  searchGames: (filters) => ipcRenderer.invoke('archive:games', filters),
  openingFacets: (filters) => ipcRenderer.invoke('archive:opening-facets', filters),
  getGame: (id) => ipcRenderer.invoke('archive:game', id),
  searchRecords: (filters) => ipcRenderer.invoke('archive:records', filters),
  getRecord: (id) => ipcRenderer.invoke('archive:record', id),
}));
