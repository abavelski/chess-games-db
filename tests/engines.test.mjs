import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EngineManager, UciProcess, engineDefaults, parseEngineInfo, validateSettings, validateRequest } from '../electron/engines.mjs';
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const request = id => ({ id, engine: 'stockfish', initialFen: fen, moves: [], turn: 'white', lines: 3, rating: 1500 });
const fake = () => new UciProcess(process.execPath, [fileURLToPath(new URL('./fixtures/fake-uci.mjs', import.meta.url))], { startupTimeout: 2000 });

test('settings and requests reject invalid values and protocol injection', () => {
  assert.equal(validateSettings({}).hash, 256);
  assert.throws(() => validateSettings({ budget: 0 }));
  assert.throws(() => validateSettings({ pythonPath: 'python\nquit' }));
  assert.throws(() => validateRequest({ ...request('1'), moves: ['e2e4\nquit'] }));
  assert.throws(() => validateRequest({ ...request('1'), rating: 599 }));
});
test('UCI scores normalize to White, retaining mate and bounds', () => {
  assert.deepEqual(parseEngineInfo('info depth 20 multipv 2 score cp 32 lowerbound pv e7e5 g1f3', 'black'), { rank: 2, depth: 20, score: { type: 'cp', value: -32, bound: 'upperbound' }, moves: ['e7e5', 'g1f3'] });
  assert.equal(parseEngineInfo('info depth 5 score mate -3 pv e2e4', 'black').score.value, 3);
  assert.equal(parseEngineInfo('info string noise'), null);
});
test('Maia adapter reports genuine policy without renormalizing top candidates', () => {
  assert.deepEqual(parseEngineInfo('info string maia-policy [{"move":"e2e4","probability":0.38}]'), { candidates: [{ move: 'e2e4', probability: 0.38 }] });
  assert.equal(parseEngineInfo('info string maia-policy [{"move":"e2e4","probability":2}]'), null);
});
test('real subprocess handshake, search, stop and shutdown', async () => {
  const engine = fake();
  try {
    await engine.ready;
    const result = engine.wait(line => line.startsWith('info depth'), 2000);
    engine.send('position startpos'); engine.searching = true; engine.send('go infinite');
    assert.match(await result, /score cp 45/);
    await engine.stop(); assert.equal(engine.searching, false);
  } finally { engine.close(); }
  assert.equal(engine.dead, true);
});
test('missing/crashed engines reject startup without hanging', async () => {
  const engine = new UciProcess('/does/not/exist', [], { startupTimeout: 100 });
  await assert.rejects(engine.ready);
  engine.close();
});
test('manager suppresses obsolete results, reuses process and preserves history', async () => {
  const events = []; let created = 0;
  const manager = new EngineManager({ ...engineDefaults, stockfishPath: process.execPath }, event => events.push(event), () => { created++; return fake(); });
  try {
    manager.analyze(request('old')); manager.analyze({ ...request('new'), moves: ['e2e4', 'e7e5'] });
    await manager.queues.get('stockfish');
    assert.equal(events.some(event => event.id === 'old'), false);
    assert.equal(events.at(-1).status, 'complete');
    const seen = [];
    manager.sessions.get('stockfish').on('line', line => seen.push(line));
    manager.analyze({ ...request('third'), moves: ['d2d4', 'd7d5'] });
    await manager.queues.get('stockfish');
    assert.equal(created, 1);
    assert.ok(seen.some(line => line.endsWith('moves d2d4 d7d5')));
    manager.stop('stockfish');
  } finally { manager.close(); }
});
