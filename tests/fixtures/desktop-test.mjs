// The launcher owns this directory so cleanup happens after Chromium exits.
export function desktopTestDirectory() {
  const directory = process.env.CHESS_DESKTOP_TEST_DIRECTORY;
  if (!directory) throw new Error('Run desktop tests through node scripts/start-electron.mjs TEST_FILE.');
  return directory;
}

export function finishDesktopTest(app, code) {
  // Preserve the test result while allowing the app's shutdown handlers to run.
  app.once('will-quit', () => app.exit(code));
  app.quit();
}
