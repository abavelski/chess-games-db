// Explicit, offline integration/benchmark run; normal tests use fixture engines.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { cpus, totalmem, platform, arch } from 'node:os';
import { EngineManager } from '../electron/engines.mjs';
import { replayPosition } from '../src/analysis.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node scripts/verify-local-engines.mjs /path/to/engines.json');
const settings = JSON.parse(readFileSync(configPath, 'utf8'));
const events = [];
const started = performance.now();
const manager = new EngineManager(settings, event => events.push({ ...event, ms: Math.round(performance.now() - started) }));
const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const request = (engine, id, moves, rating = 1500) => ({ engine, id, initialFen, moves, rating, lines: 3, turn: replayPosition(initialFen, moves).turn });
try {
  const first = ['e2e4', 'e7e5'];
  manager.analyze(request('stockfish', 'stockfish-cold', first));
  manager.analyze(request('maia', 'maia-cold', first));
  await Promise.all([...manager.queues.values()]);
  assert.ok(!events.some(event => event.status === 'error'), JSON.stringify(events.filter(event => event.error)));
  const warmStart = performance.now();
  manager.analyze(request('maia', 'maia-warm', ['d2d4', 'd7d5'], 1800));
  await manager.queues.get('maia');
  const warmMs = Math.round(performance.now() - warmStart);
  for (const id of ['maia-cold', 'maia-warm']) {
    const candidates = events.find(event => event.id === id && event.candidates)?.candidates;
    assert.ok(candidates?.length, `No policy output for ${id}`);
    assert.ok(candidates.reduce((sum, item) => sum + item.probability, 0) <= 1.00001);
    const current = id === 'maia-cold' ? first : ['d2d4', 'd7d5'];
    for (const candidate of candidates) replayPosition(initialFen, [...current, candidate.move]);
  }
  const finalLine = events.filter(event => event.id === 'stockfish-cold' && event.moves && event.rank === 1).at(-1);
  assert.ok(finalLine?.depth > 0); replayPosition(initialFen, [...first, ...finalLine.moves]);
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(settings.checkpointPath)) checksum.update(chunk);
  const processes = [...manager.sessions.values()];
  const exits = processes.map(session => once(session.child, 'exit'));
  const report = {
    hardware: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, memoryGiB: Math.round(totalmem() / 2 ** 30) },
    stockfish: { name: manager.sessions.get('stockfish')?.name, threads: manager.settings.threads, hashMB: manager.settings.hash, budgetMs: manager.settings.budget, completeMs: events.find(event => event.id === 'stockfish-cold' && event.status === 'complete')?.ms, depth: finalLine.depth, evaluation: finalLine.score },
    maia: { model: 'Maia 3 79M', device: events.find(event => event.device)?.device, checkpointSha256: checksum.digest('hex'), coldCompleteMs: events.find(event => event.id === 'maia-cold' && event.status === 'complete')?.ms, warmMs, candidates: events.find(event => event.id === 'maia-cold' && event.candidates)?.candidates },
  };
  manager.close(); await Promise.all(exits);
  report.processCleanup = 'all engine subprocesses exited';
  console.log(JSON.stringify(report, null, 2));
} finally { manager.close(); }
