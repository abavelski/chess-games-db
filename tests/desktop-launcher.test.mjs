import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const code of [0, 7]) {
  test(`desktop launcher cleans locked profiles after exit and preserves status ${code}`, () => {
    const result = spawnSync(process.execPath, ['scripts/start-electron.mjs', 'tests/fixtures/lifecycle-desktop-smoke.mjs'], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, CHESS_TEST_EXIT_CODE: String(code) },
    });
    assert.ifError(result.error);
    assert.equal(result.status, code, result.stderr);
    const directory = result.stdout.match(/DESKTOP_TEST_PROFILE=([^\r\n]+)/)?.[1];
    assert.ok(directory, result.stdout + result.stderr);
    assert.equal(existsSync(directory), false, 'Parent must remove the profile after Electron exits');
    assert.doesNotMatch(result.stderr, /Uncaught Exception|Could not remove desktop test profile/);
  });
}
