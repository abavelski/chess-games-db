import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChessArchive } from './database.mjs';

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
  const { desktop, load } = desktopWindow('Chess Books Explorer');
  window = desktop;
  desktop.on('closed', () => { if (window === desktop) window = null; });
  void load();
}

app.whenReady().then(() => {
  ipcMain.handle('archive:open', async () => {
    const answer = await dialog.showOpenDialog(window, {
      title: 'Open Chess Books SQLite archive',
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
  ipcMain.handle('archive:book', (_event, bookId) => currentArchive().bookContents(bookId));
  ipcMain.handle('archive:catalog', () => archive ? archive.catalog() : null);
  ipcMain.handle('archive:games', (_event, filters) => currentArchive().searchGames(filters));
  ipcMain.handle('archive:game', (_event, id) => currentArchive().getGame(id));
  ipcMain.handle('archive:records', (_event, filters) => currentArchive().searchRecords(filters));
  ipcMain.handle('archive:record', (_event, id) => currentArchive().getRecord(id));

  const candidates = [];
  try {
    const previous = JSON.parse(readFileSync(preferencePath(), 'utf8'));
    if (typeof previous.path === 'string') candidates.push(previous.path);
  } catch { /* First launch. */ }
  if (!app.isPackaged) candidates.push(join(here, '..', 'data', 'chess-books.sqlite3'));
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
