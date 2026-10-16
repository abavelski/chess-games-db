import { spawn } from 'node:child_process';
import electron from 'electron';

// Use the same native SQLite ABI as the desktop app, without starting Chromium.
const child = spawn(electron, process.argv.slice(2), {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
