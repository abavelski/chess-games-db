import { createInterface } from 'node:readline';
let timer;
let position = '';
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'uci') console.log('id name Fixture Stockfish\nuciok');
  if (command === 'isready') console.log('readyok');
  if (command.startsWith('position ')) position = command;
  if (command.startsWith('go ')) {
    console.log(`info string position ${position}`);
    console.log('info depth 12 multipv 1 score cp 45 pv e2e4 e7e5');
    timer = setTimeout(() => { timer = null; console.log('bestmove e2e4'); }, 60);
  }
  if (command === 'stop' && timer) { clearTimeout(timer); timer = null; console.log('bestmove e2e4'); }
  if (command === 'quit') process.exit(0);
}
