import { openSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { desktopTestDirectory, finishDesktopTest } from './desktop-test.mjs';

const directory = desktopTestDirectory();
app.setPath('userData', directory);
// Keep a Windows file handle open until process exit, like Chromium's profile.
openSync(join(directory, 'held-profile-file'), 'w');
console.log('DESKTOP_TEST_PROFILE=' + directory);
void app.whenReady().then(() => finishDesktopTest(app, Number(process.env.CHESS_TEST_EXIT_CODE)));
