import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// Failure-only local diagnostics; bounded to the current and previous log.
export function engineFailureLogger(path, maxBytes = 1024 * 1024) {
  return failure => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const entry = JSON.stringify({ time: new Date().toISOString(), ...failure }) + '\n';
      if (existsSync(path) && statSync(path).size + Buffer.byteLength(entry) > maxBytes) renameSync(path, path + '.1');
      appendFileSync(path, entry, { mode: 0o600 });
    } catch (error) { console.warn('Could not write engine diagnostic log:', error.message); }
  };
}
