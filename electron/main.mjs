import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChessArchive } from './database.mjs';
import { registerEngineIpc } from './engine-ipc.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
let window;
let archive;
let currentPath = null;

const preferencePath = () => join(app.getPath('userData'), 'archive.json');

function attachArchive(path) {
  const candidate = new ChessArchive(path);
  const old = archive;
  archive = candidate;
  currentPath = resolve(path);
  old?.close();
  try {
    writeFileSync(preferencePath(), JSON.stringify({ path: currentPath }), 'utf8');
  } catch (error) {
    console.warn('Could not save last opened database', error);
  }
  return archive.catalog();
}

function currentArchive() {
  if (!archive) throw new Error('Open a SQLite chess archive first.');
  return archive;
}

function desktopWindow(title) {
  const desktop = new BrowserWindow({
    width: 1510,
    height: 920,
    minWidth: 920,
    minHeight: 650,
    title,
    backgroundColor: '#f6f3ec',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  desktop.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  desktop.webContents.on('will-navigate', (event) => event.preventDefault());
  return {
    desktop,
    load: () => !app.isPackaged && process.argv.includes('--dev')
      ? desktop.loadURL('http://127.0.0.1:5173/')
      : desktop.loadFile(join(here, '..', 'dist', 'index.html')),
  };
}

function createWindow() {
  const { desktop, load } = desktopWindow('Annotated Games Explorer');
  window = desktop;
  desktop.on('closed', () => { if (window === desktop) window = null; });
  void load();
}

app.whenReady().then(() => {
  registerEngineIpc({ app, ipcMain, dialog });
  ipcMain.handle('archive:open', async () => {
    const answer = await dialog.showOpenDialog(window, {
      title: 'Open annotated games database',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite databases', extensions: ['sqlite3', 'sqlite', 'db'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (answer.canceled || !answer.filePaths.length) return { canceled: true };
    const catalog = attachArchive(answer.filePaths[0]);
    return { canceled: false, catalog };
  });
  ipcMain.handle('archive:catalog', () => archive ? archive.catalog() : null);
  ipcMain.handle('archive:games', (_event, filters) => currentArchive().searchGames(filters));
  ipcMain.handle('archive:position-search', (_event, fen, filters) => currentArchive().searchByPosition(fen, filters));
  ipcMain.handle('archive:opening-facets', (_event, filters) => currentArchive().openingFacets(filters));
  ipcMain.handle('archive:property-options', (_event, request) => currentArchive().propertyOptions(request));
  ipcMain.handle('archive:favourite', (_event, id, favourite) => currentArchive().setFavourite(id, favourite));
  ipcMain.handle('archive:personal', (_event, id, personal) => currentArchive().savePersonal(id, personal));
  ipcMain.handle('archive:game', (_event, id) => currentArchive().getGame(id));

  const candidates = [];
  try {
    const previous = JSON.parse(readFileSync(preferencePath(), 'utf8'));
    if (typeof previous.path === 'string') candidates.push(previous.path);
  } catch { /* First launch. */ }
  if (!app.isPackaged) candidates.push(join(here, '..', 'data', 'annotated-games.sqlite3'));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try { attachArchive(candidate); break; }
      catch (error) { console.warn('Could not open archive', candidate, error); }
    }
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  archive?.close();
  archive = null;
});
