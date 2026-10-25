import { Worker } from 'node:worker_threads';

export const OPENING_METHODS = Object.freeze(['catalog','explore','materials','articleCatalog','article','study']);
export function validateOpeningPayload(method, args) {
  if (!OPENING_METHODS.includes(method)) throw new Error('Unsupported opening operation');
  const serialized = JSON.stringify(args ?? {});
  if (Buffer.byteLength(serialized) > 32_768) throw new Error('Opening request exceeds payload limit');
  return args;
}

export class OpeningWorkerClient {
  constructor(path) {
    if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('Invalid opening library path');
    this.worker = new Worker(new URL('./opening-query-worker.mjs', import.meta.url), { workerData: { path } });
    this.pending = new Map(); this.nextId = 0; this.exploreWaiting = null; this.exploreRunning = false; this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    void this.ready.catch(() => {}); // Opening may be cancelled before a caller awaits it.
    this.worker.on('message', message => {
      if (message.type === 'ready') { this.readyResolve(message.catalog); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else pending.resolve(message.result);
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => { if (!this.closed) this.fail(new Error(`Opening worker stopped (${code}); reopen the library`)); });
  }
  fail(error) {
    this.closed = true; this.readyReject(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear(); this.exploreWaiting?.reject(error); this.exploreWaiting = null;
  }
  async invoke(method, args) {
    validateOpeningPayload(method, args);
    await this.ready;
    if (this.closed) throw new Error('Opening worker is closed; reopen the library');
    if (this.pending.size >= 8) throw new Error('Opening service is busy; retry the request');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, method, args });
    });
  }
  call(method, args) {
    try { validateOpeningPayload(method, args); } catch (error) { return Promise.reject(error); }
    if (method !== 'explore') return this.invoke(method, args);
    // Keep one running and one newest pending exploration. Rapid board input
    // never creates an unbounded queue behind an expensive root query.
    return new Promise((resolve, reject) => {
      this.exploreWaiting?.reject(Object.assign(new Error('Exploration superseded'), { code: 'CANCELLED' }));
      this.exploreWaiting = { args, resolve, reject };
      void this.drainExplore();
    });
  }
  async drainExplore() {
    if (this.exploreRunning || !this.exploreWaiting) return;
    this.exploreRunning = true;
    const next = this.exploreWaiting; this.exploreWaiting = null;
    try { next.resolve(await this.invoke('explore', next.args)); }
    catch (error) { next.reject(error); }
    finally { this.exploreRunning = false; if (this.exploreWaiting) void this.drainExplore(); }
  }
  async close() {
    this.fail(new Error('Opening library closed'));
    await this.worker.terminate();
  }
}

export function registerOpeningQueryIpc({ ipcMain, getClient, authorize = () => true }) {
  for (const method of OPENING_METHODS) ipcMain.handle(`opening-study:${method}`, (event, args) => {
    if (!authorize(event)) throw new Error('Opening request is not from an application window');
    validateOpeningPayload(method, args);
    const client = getClient();
    if (!client) throw new Error('Open an opening library first');
    return client.call(method, args);
  });
}
