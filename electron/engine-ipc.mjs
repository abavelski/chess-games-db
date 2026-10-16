import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { EngineManager, engineDefaults, validateSettings } from './engines.mjs';

export function registerEngineIpc({ app, ipcMain, dialog }) {
  const path = join(app.getPath('userData'), 'engines.json');
  let settings = { ...engineDefaults };
  const candidates = [path];
  if (!app.isPackaged) candidates.push(fileURLToPath(new URL('../.local-engines/engines.json', import.meta.url)));
  for (const candidate of candidates) {
    try { settings = validateSettings(JSON.parse(readFileSync(candidate, 'utf8'))); break; }
    catch { /* First launch or invalid settings; try the local development profile. */ }
  }
  const managers = new Map();
  const manager = sender => {
    if (!managers.has(sender.id)) {
      const instance = new EngineManager(settings, event => { if (!sender.isDestroyed()) sender.send('engine:update', event); });
      managers.set(sender.id, instance);
      sender.once('destroyed', () => { instance.close(); managers.delete(sender.id); });
      sender.on('did-start-loading', () => instance.close());
    }
    return managers.get(sender.id);
  };
  ipcMain.handle('engine:settings', event => manager(event.sender).configuration());
  ipcMain.handle('engine:configure', (event, input) => {
    const next = validateSettings(input);
    writeFileSync(path, JSON.stringify(next, null, 2)); settings = next;
    for (const instance of managers.values()) instance.configure(next);
    return manager(event.sender).configuration();
  });
  ipcMain.handle('engine:pick', async (_event, kind) => {
    if (!['stockfishPath', 'pythonPath', 'checkpointPath'].includes(kind)) throw new Error('Invalid engine file');
    const result = await dialog.showOpenDialog({ title: kind === 'checkpointPath' ? 'Select Maia 3 79M checkpoint (.pt)' : 'Select engine executable', properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('engine:analyze', (event, request) => manager(event.sender).analyze(request));
  ipcMain.handle('engine:stop', (event, engine) => manager(event.sender).stop(engine));
  app.on('will-quit', () => { for (const instance of managers.values()) instance.close(); });
}
