#!/usr/bin/env node
import { createInterface } from 'node:readline';
let rating = 1500;
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'uci') console.log('uciok');
  if (command === 'isready') console.log('readyok');
  if (command.startsWith('setoption name Elo value ')) rating = Number(command.split(' ').at(-1));
  if (command.startsWith('go ')) {
    console.log('info string engine-device cpu');
    console.log('info string maia-policy ' + JSON.stringify([{ move: 'e2e4', probability: rating === 1500 ? 0.38 : 0.42 }, { move: 'd2d4', probability: 0.22 }]));
    console.log('bestmove e2e4');
  }
  if (command === 'quit') process.exit(0);
}
