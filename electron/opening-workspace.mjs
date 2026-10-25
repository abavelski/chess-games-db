import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpeningWorkerClient, registerOpeningQueryIpc } from './opening-query-client.mjs';
import { OpeningUserStore } from '../lib/opening-user-store.mjs';

export function registerOpeningWorkspace({ app, ipcMain, dialog, getWindow, authorize }) {
  const preferencePath = join(app.getPath('userData'), 'opening-library.json');
  mkdirSync(app.getPath('userData'), { recursive: true });
  let store = null, settingsError = null;
  try { store = new OpeningUserStore(join(app.getPath('userData'), 'opening-user.sqlite3')); }
  catch (cause) { settingsError = `Opening settings unavailable: ${cause.message}`; }
  ipcMain.handle('opening-study:settings', (event, patch) => {
    if (!authorize(event)) throw new Error('Opening request is not from an application window');
    if (!store) throw new Error(settingsError);
    return patch === undefined ? store.read() : store.patch(patch);
  });
  let client = null, catalog = null, path = null, error = null, generation = 0;
  const workers = new Set();
  async function attach(file) {
    const ticket = ++generation, candidate = new OpeningWorkerClient(resolve(file));
    workers.add(candidate);
    try {
      const next = await candidate.ready;
      if (ticket !== generation) throw new Error('Opening library load superseded');
      const old = client;
      client = candidate; catalog = next; path = resolve(file); error = null;
      mkdirSync(app.getPath('userData'), { recursive: true });
      try { writeFileSync(preferencePath, JSON.stringify({ format: 'opening-study-preferences-v1', path }), 'utf8'); }
      catch (saveError) { console.warn('Could not remember opening library', saveError.message); }
      if (old) { workers.delete(old); await old.close(); }
      return { catalog, path, error: null };
    } catch (loadError) {
      workers.delete(candidate); await candidate.close();
      if (ticket === generation) error = String(loadError.message).slice(0, 1024);
      throw loadError;
    }
  }
  let restore = Promise.resolve();
  try {
    if (existsSync(preferencePath)) {
      const previous = JSON.parse(readFileSync(preferencePath, 'utf8'));
      if (typeof previous.path === 'string' && previous.path.length <= 4096) {
        path = previous.path;
        restore = attach(path).then(() => {}, () => {});
      }
    }
  } catch (loadError) { error = String(loadError.message).slice(0, 1024); }
  registerOpeningQueryIpc({ ipcMain, getClient: () => client, authorize });
  ipcMain.handle('opening-study:status', async event => {
    if (!authorize(event)) throw new Error('Opening request is not from an application window');
    await restore;
    return { catalog, path, error };
  });
  ipcMain.handle('opening-study:open', async event => {
    if (!authorize(event)) throw new Error('Opening request is not from an application window');
    const answer = await dialog.showOpenDialog(getWindow(), { title: 'Open opening study library', properties: ['openFile'],
      filters: [{ name: 'Opening runtime library', extensions: ['sqlite3','sqlite','db'] }] });
    if (answer.canceled || !answer.filePaths.length) return { canceled: true };
    return { canceled: false, ...await attach(answer.filePaths[0]) };
  });
  return {
    async close() {
      generation++; client = null;
      await Promise.allSettled([...workers].map(worker => worker.close())); workers.clear();
      store?.close(); store = null;
    },
  };
}
