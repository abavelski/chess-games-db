import { spawn } from 'node:child_process';
import electron from 'electron';

// Coding tools and parent Electron apps can export this variable. The desktop
// child must start Chromium rather than interpreting the app as a Node script.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env });
child.on('error', error => {
  console.error('Could not start Electron:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
