import { createInterface } from 'node:readline';
import { makeUci, parseUci } from 'chessops/util';
import { normalizeMove } from 'chessops/chess';
import { replayPosition } from '../../src/analysis.mjs';
let position, timer;
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'uci') console.log('uciok');
  if (command === 'isready') console.log('readyok');
  if (command.startsWith('position fen ')) {
    const [fen, moves = ''] = command.slice(13).split(' moves ');
    position = replayPosition(fen, moves.trim().split(' ').filter(Boolean)).position;
  }
  if (command.startsWith('go ')) {
    const preferred = parseUci(position.turn === 'white' ? 'e2e4' : 'e7e5');
    let move = position.isLegal(preferred) ? preferred : null;
    if (!move) for (const [from, dests] of position.allDests()) {
      for (const to of dests) {
        const candidate = { from, to, ...(position.board.get(from).role === 'pawn' && [0,7].includes(to >> 3) ? { promotion: 'queen' } : {}) };
        if (position.isLegal(candidate)) { move = candidate; break; }
      }
      if (move) break;
    }
    const uci = move ? makeUci(normalizeMove(position, move)) : '0000';
    timer = setTimeout(() => {
      timer = null;
      console.log('info string maia-policy ' + JSON.stringify(move ? [{ move: uci, probability: 1 }] : []));
      console.log('bestmove ' + uci);
    }, 250);
  }
  if (command === 'stop' && timer) { clearTimeout(timer); timer = null; console.log('bestmove 0000'); }
  if (command === 'quit') process.exit(0);
}
