import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
export const extractionRoot = fileURLToPath(new URL('../../tools/extraction/', import.meta.url));
export function preflight(format) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ required');
  if (format === '.pgn') return {};
  const pins = JSON.parse(readFileSync(join(extractionRoot, 'pins.json'), 'utf8'));
  let prepared;
  try { prepared = JSON.parse(readFileSync(join(extractionRoot, 'target/prepared.json'), 'utf8')); }
  catch { throw new Error('ChessBase tools not prepared: run python3 tools/extraction/scripts/setup.py'); }
  if (JSON.stringify(pins) !== JSON.stringify(prepared)) throw new Error('Prepared extraction tools have different pins; rerun setup');
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const version = /version "(\d+)/.exec(java.stderr ?? '');
  if (java.status !== 0 || !version || Number(version[1]) < 21) throw new Error('JDK 21+ required');
  const classpath = join(extractionRoot, 'target/classes') + delimiter + readFileSync(join(extractionRoot, 'target/import-classpath.txt'), 'utf8').trim();
  const python = process.platform === 'win32' ? 'python' : 'python3';
  if (spawnSync(python, ['--version']).status !== 0) throw new Error('Python 3 required');
  const uncbv = join(extractionRoot, '.deps/uncbv/bin', process.platform === 'win32' ? 'uncbv.exe' : 'uncbv');
  if (format === '.cbv' && !existsSync(uncbv)) throw new Error('CBV tool missing: run setup.py --cbv explicitly');
  return { classpath, python, uncbv, pins };
}
