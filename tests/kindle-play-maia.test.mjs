import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EngineManager, UciProcess } from '../electron/engines.mjs';
import { KindlePlayMaia } from '../electron/kindle-play-maia.mjs';
import { initialFen } from '../electron/kindle-play-game.mjs';
const fixture = fileURLToPath(new URL('./fixtures/kindle-uci.mjs', import.meta.url));
const playing = fileURLToPath(new URL('./fixtures/fake-playing-maia.mjs', import.meta.url));
const settings = { pythonPath: process.execPath, checkpointPath: fixture };
const request = { initialFen, moves: ['e2e4'], rating: 1500 };

test('lazy independent process, exact commands, ratings, complete history and serialization', async () => {
  const sessions = [], commands = [];
  const maia = new KindlePlayMaia(settings, { processFactory: () => {
    const session = new UciProcess(process.execPath, [playing]); sessions.push(session);
    const send = session.send.bind(session); session.send = command => { commands.push(command); send(command); };
    return session;
  } });
  const analysis = new EngineManager(settings, () => {}, () => new UciProcess(process.execPath, [playing]));
  try {
    assert.equal(maia.available(), true); assert.equal(sessions.length, 0);
    analysis.analyze({ ...request, id: 'ui', engine: 'maia', turn: 'black', lines: 1 });
    const [first, second] = await Promise.all([maia.move(request), maia.move({ ...request, moves: ['e2e4','e7e5','g1f3'], rating: 2300 })]);
    assert.equal(first, 'e7e5'); assert.match(second, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
    await analysis.queues.get('maia'); analysis.stop('maia');
    assert.equal(sessions.length, 1);
    assert.deepEqual(commands, ['isready', 'setoption name Elo value 1500', `position fen ${initialFen} moves e2e4`, 'go nodes 1', 'setoption name Elo value 2300', `position fen ${initialFen} moves e2e4 e7e5 g1f3`, 'go nodes 1']);
    assert.notEqual(maia.session, analysis.sessions.get('maia'));
    assert.equal(await maia.move(request), 'e7e5');
  } finally { maia.close(); analysis.close(); }
  assert.ok(sessions.every(session => session.dead));
  await assert.rejects(maia.move(request), { code: 'ENGINE_UNAVAILABLE' });
});

test('crash, illegal output, timeout and cold startup timeout discard process and allow retry', async () => {
  for (const mode of ['crash', '0000', 'e7e4', 'timeout', 'startup-timeout']) {
    let count = 0; const sessions = [];
    const maia = new KindlePlayMaia(settings, { deadline: 1500, log: () => {}, processFactory: () => {
      const session = new UciProcess(process.execPath, [fixture, count++ ? 'e7e5' : mode]); sessions.push(session); return session;
    } });
    try {
      await assert.rejects(maia.move(request), { code: mode.includes('timeout') ? 'ENGINE_TIMEOUT' : 'ENGINE_UNAVAILABLE' });
      assert.equal(sessions[0].dead, true);
      assert.equal(await maia.move(request), 'e7e5');
    } finally { maia.close(); }
  }
});

test('engine king-to-rook castle normalizes and full history uses standard UCI', async () => {
  const history = ['e2e4','e7e5','g1f3','g8f6','f1e2','f8e7','e1g1'];
  const maia = new KindlePlayMaia(settings, { processFactory: () => new UciProcess(process.execPath, [fixture, 'e8h8']) });
  try { assert.equal(await maia.move({ ...request, moves: history }), 'e8g8'); }
  finally { maia.close(); }
});

test('missing configuration never starts a process', async () => {
  const maia = new KindlePlayMaia({}, { processFactory: () => { throw Error('must not start'); } });
  assert.equal(maia.available(), false);
  await assert.rejects(maia.move(request), { code: 'ENGINE_UNAVAILABLE' });
  maia.close();
});
