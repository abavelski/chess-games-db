import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFailureLogger } from '../electron/engine-log.mjs';
import { fileURLToPath } from 'node:url';
import { EngineManager, UciProcess, enginePosition, engineDefaults, parseEngineInfo, validateSettings, validateRequest } from '../electron/engines.mjs';
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
test('invalid positions, impossible histories and incorrect score perspectives are rejected', () => {
  assert.throws(() => validateRequest({ ...request('bad'), initialFen: '8/8/8/8/8/8/8/8 w - - 0 1' }), /Invalid analysis position/);
  assert.throws(() => validateRequest({ ...request('bad'), moves: ['e2e5'] }), /Invalid analysis position/);
  assert.throws(() => validateRequest({ ...request('bad'), moves: ['e2e4'], turn: 'white' }), /Invalid analysis position/);
});
test('startup timeout kills an unresponsive process', async () => {
  const engine = new UciProcess(process.execPath, ['-e', 'process.stdin.resume()'], { startupTimeout: 80 });
  await assert.rejects(engine.ready, /timed out/);
  assert.equal(engine.dead, true);
});
test('replacement during active search drains old output and disabling suppresses completion', async () => {
  const events = [];
  const manager = new EngineManager({ stockfishPath: process.execPath }, event => events.push(event), fake);
  try {
    manager.analyze(request('first'));
    while (!events.some(event => event.id === 'first' && event.moves)) await new Promise(resolve => setTimeout(resolve, 5));
    manager.analyze({ ...request('second'), moves: ['e2e4'], turn: 'black' });
    await manager.queues.get('stockfish');
    const last = events.filter(event => event.id === 'second');
    assert.equal(last.at(-1).status, 'complete');
    assert.equal(last.find(event => event.score)?.score.value, -45);
    assert.equal(events.some(event => event.id === 'first' && event.status === 'complete'), false);
    manager.analyze(request('disabled')); manager.stop('stockfish');
    await manager.queues.get('stockfish');
    assert.equal(events.some(event => event.id === 'disabled'), false);
  } finally { manager.close(); }
});
test('terminal mate and drawn positions retain evaluation without a principal variation', () => {
  const matedWhite = parseEngineInfo('info depth 0 score mate 0', 'white');
  assert.equal(matedWhite.score.winner, 'black');
  assert.deepEqual(matedWhite.moves, []);
  assert.equal(parseEngineInfo('info depth 0 score mate 0', 'black').score.winner, 'white');
  assert.equal(parseEngineInfo('info depth 0 score cp 0', 'black').score.value, -0);
});

test('engine history converts castling for both colors and wings without changing book moves', () => {
  const start = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  for (const [moves, expected] of [
    [['e1h1', 'e8a8'], 'e1g1 e8c8'],
    [['e1a1', 'e8h8'], 'e1c1 e8g8'],
    [['e1g1', 'e8c8'], 'e1g1 e8c8'],
  ]) {
    const input = { ...request('castle'), initialFen: start, moves };
    validateRequest(input);
    assert.equal(enginePosition(input), `position fen ${start} moves ${expected}`);
    assert.deepEqual(input.moves, moves);
  }
  const history = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1h1'];
  const input = { ...request('ruy-lopez'), moves: history, turn: 'black' };
  validateRequest(input);
  assert.ok(enginePosition(input).endsWith('g8f6 e1g1'));
});
test('startup failures preserve stdout diagnostics, exit code and local rotated logs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chess-engine-log-'));
  const path = join(directory, 'logs', 'engines.log');
  const failures = [];
  const logger = engineFailureLogger(path, 200);
  const manager = new EngineManager({ stockfishPath: process.execPath }, () => {}, () => new UciProcess(process.execPath, ['-e', "console.log('info string CRITICAL ERROR: Illegal move: e1h1'); process.exitCode = 7"]), failure => { failures.push(failure); logger(failure); });
  try {
    manager.analyze(request('failed-position')); await manager.queues.get('stockfish');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].exitCode, 7);
    assert.match(failures[0].message, /CRITICAL ERROR: Illegal move: e1h1/);
    assert.equal(failures[0].request.id, 'failed-position');
    assert.ok(failures[0].trace.some(entry => entry.stream === 'stdout' && entry.text.includes('Illegal move')));
    logger({ engine: 'stockfish', message: 'next failure' });
    assert.match(readFileSync(path + '.1', 'utf8'), /Illegal move/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).message, 'next failure');
  } finally { manager.close(); rmSync(directory, { recursive: true, force: true }); }
});
