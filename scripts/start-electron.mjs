import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import electron from 'electron';

// Coding tools and parent Electron apps can export this variable. The desktop
// child must start Chromium rather than interpreting the app as a Node script.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Chromium keeps profile files open through will-quit. The parent owns the
// test profile and deletes it only after Electron and its stdio have closed.
const isDesktopTest = /^(?:.*desktop-smoke|real-engine-desktop)\.mjs$/.test(basename(process.argv[2] ?? ''));
const testDirectory = isDesktopTest ? mkdtempSync(join(tmpdir(), 'chess-desktop-test-')) : null;
delete env.CHESS_DESKTOP_TEST_DIRECTORY;
if (testDirectory) env.CHESS_DESKTOP_TEST_DIRECTORY = testDirectory;

const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env });
child.on('error', error => {
  console.error('Could not start Electron:', error.message);
  process.exitCode = 1;
});
child.on('close', async (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
  if (!testDirectory) return;
  try {
    await rm(testDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  } catch (error) {
    console.error(`Could not remove desktop test profile ${testDirectory}: ${error.message}`);
    process.exitCode = process.exitCode || 1;
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
