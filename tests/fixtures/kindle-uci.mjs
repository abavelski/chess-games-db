import { createInterface } from 'node:readline';
const mode = process.argv[2];
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'uci' && mode !== 'startup-timeout') console.log('uciok');
  if (command === 'isready') console.log('readyok');
  if (command.startsWith('go ')) {
    if (mode === 'crash') process.exit(1);
    if (!['timeout', 'startup-timeout'].includes(mode)) console.log('bestmove ' + mode);
  }
  if (command === 'quit') process.exit(0);
}
