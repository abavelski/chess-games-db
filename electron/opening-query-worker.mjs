import { parentPort, workerData } from 'node:worker_threads';
import { OpeningQueryService } from '../lib/opening-query.mjs';

const service = new OpeningQueryService(workerData.path);
const methods = new Set(['catalog','explore','materials','articleCatalog','article','study']);
parentPort.postMessage({ type: 'ready', catalog: service.catalog() });
parentPort.on('message', message => {
  if (!message || !Number.isSafeInteger(message.id) || !methods.has(message.method)) return;
  try {
    const result = service[message.method](message.args);
    parentPort.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: { code: error.code ?? 'OPENING_QUERY_FAILED', message: String(error.message).slice(0, 1024) } });
  }
});
parentPort.on('close', () => service.close());
