'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('personalStudies', Object.freeze({
  openPgn: () => ipcRenderer.invoke('personal-studies:openPgn'),
  onCloseRequest: callback => {
    const listener = () => callback();
    ipcRenderer.on('personal-studies:request-close', listener);
    return () => ipcRenderer.removeListener('personal-studies:request-close', listener);
  },
  status: () => ipcRenderer.invoke('personal-studies:status'),
  list: request => ipcRenderer.invoke('personal-studies:list', request),
  get: request => ipcRenderer.invoke('personal-studies:get', request),
  create: request => ipcRenderer.invoke('personal-studies:create', request),
  update: request => ipcRenderer.invoke('personal-studies:update', request),
  duplicate: request => ipcRenderer.invoke('personal-studies:duplicate', request),
  delete: request => ipcRenderer.invoke('personal-studies:delete', request),
}));

contextBridge.exposeInMainWorld('openingStudy', Object.freeze({
  status: () => ipcRenderer.invoke('opening-study:status'),
  settings: patch => ipcRenderer.invoke('opening-study:settings', patch),
  openLibrary: () => ipcRenderer.invoke('opening-study:open'),
  explore: request => ipcRenderer.invoke('opening-study:explore', request),
  materials: request => ipcRenderer.invoke('opening-study:materials', request),
  articleCatalog: request => ipcRenderer.invoke('opening-study:articleCatalog', request),
  article: request => ipcRenderer.invoke('opening-study:article', request),
  study: request => ipcRenderer.invoke('opening-study:study', request),
}));

// Renderer code has no Node.js or direct SQL access.
contextBridge.exposeInMainWorld('chessArchive', Object.freeze({
  openDatabase: () => ipcRenderer.invoke('archive:open'),
  getCatalog: () => ipcRenderer.invoke('archive:catalog'),
  searchGames: (filters) => ipcRenderer.invoke('archive:games', filters),
  searchByPosition: (fen, filters) => ipcRenderer.invoke('archive:position-search', fen, filters),
  openingFacets: (filters) => ipcRenderer.invoke('archive:opening-facets', filters),
  propertyOptions: (request) => ipcRenderer.invoke('archive:property-options', request),
  setFavourite: (id, favourite) => ipcRenderer.invoke('archive:favourite', id, favourite),
  savePersonal: (id, personal) => ipcRenderer.invoke('archive:personal', id, personal),
  getGame: (id) => ipcRenderer.invoke('archive:game', id),
}));

contextBridge.exposeInMainWorld('chessEngine', Object.freeze({
  settings: () => ipcRenderer.invoke('engine:settings'),
  configure: settings => ipcRenderer.invoke('engine:configure', settings),
  pick: kind => ipcRenderer.invoke('engine:pick', kind),
  analyze: request => ipcRenderer.invoke('engine:analyze', request),
  stop: engine => ipcRenderer.invoke('engine:stop', engine),
  onUpdate: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('engine:update', listener);
    return () => ipcRenderer.removeListener('engine:update', listener);
  },
}));
