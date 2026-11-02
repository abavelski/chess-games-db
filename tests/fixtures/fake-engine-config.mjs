import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineManager, UciProcess } from '../../electron/engines.mjs';

// Run the synthetic UCI scripts through Node on every OS, including Windows
// where a .mjs file cannot be spawned directly as an executable.
export function configureFakeEngines(directory) {
  const stockfishPath = fileURLToPath(new URL('./fake-uci.mjs', import.meta.url));
  const pythonPath = fileURLToPath(new URL('./fake-maia.mjs', import.meta.url));
  writeFileSync(join(directory, 'engines.json'), JSON.stringify({ stockfishPath, pythonPath,
    checkpointPath: pythonPath, device: 'cpu', threads: 1, hash: 16, budget: 100 }));
  const session = EngineManager.prototype.session;
  EngineManager.prototype.session = function(engine) {
    const factory = this.processFactory;
    this.processFactory = (command, args) => command === stockfishPath || command === pythonPath
      ? new UciProcess('node', [command]) : factory(command, args);
    try { return session.call(this, engine); }
    finally { this.processFactory = factory; }
  };
}
