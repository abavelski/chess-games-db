#!/usr/bin/env node
import { createInterface } from 'node:readline';
let timer;
let position = '';
let multipv = 1;
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'uci') console.log('id name Fixture Stockfish\nuciok');
  if (command === 'isready') console.log('readyok');
  if (command.startsWith('position ')) position = command;
  if (command.startsWith('setoption name MultiPV value ')) multipv = Number(command.split(' ').at(-1));
  if (command.startsWith('go ')) {
    console.log(`info string position ${position}`);
    for (let rank = 1; rank <= multipv; rank++) console.log(`info depth 12 multipv ${rank} score cp 45 pv e2e4 e7e5`);
    timer = setTimeout(() => { timer = null; console.log('bestmove e2e4'); }, 60);
  }
  if (command === 'stop' && timer) { clearTimeout(timer); timer = null; console.log('bestmove e2e4'); }
  if (command === 'quit') process.exit(0);
}
