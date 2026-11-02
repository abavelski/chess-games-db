import { app } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
import { configureFakeEngines } from './fixtures/fake-engine-config.mjs';
import { EngineManager } from '../electron/engines.mjs';

const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
const path = join(temporary, 'games.sqlite');
fixtureArchive(path, ['1. e4 e5 *', '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 25"]\n\n*']).close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
configureFakeEngines(temporary, { maiaFile: 'fake-playing-maia.mjs' });
const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex'), original = hash();
const requests = [], errors = [], analyze = EngineManager.prototype.analyze;
EngineManager.prototype.analyze = function(request) { requests.push(request); return analyze.call(this, request); };
app.on('browser-window-created', (_event, window) => window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));

async function smoke() {
  const timeout = setTimeout(() => { console.error('Piece mode desktop timed out'); app.exit(1); }, 45000);
  let code = 0;
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    window.focus();
    const run = code => window.webContents.executeJavaScript(`(async()=>{try{return await ${code};}catch(error){throw Error(error.stack)}})()`);
    await run(`(async()=>{
      window.waitPiece=async p=>{const end=Date.now()+8000;while(!p()){if(Date.now()>end)throw Error('Piece mode did not update: '+p+' '+document.querySelector('.piece-mode')?.textContent);await new Promise(r=>setTimeout(r,20));}};
      window.pieceButton=text=>[...document.querySelectorAll('.piece-mode button')].find(b=>b.textContent===text);
      window.pieceFen=()=>document.querySelector('.piece-board').dataset.fen;
      window.pieceSelect=(name,value)=>{const el=document.querySelector('.piece-mode [aria-label="'+name+'"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));};
      await waitPiece(()=>document.querySelector('.result-item'));
      document.querySelector('.result-item').click();await waitPiece(()=>document.querySelector('.review-board')?.dataset.fen);
      window.reviewBefore=document.querySelector('.review-board').dataset.fen;
      [...document.querySelectorAll('button')].find(b=>b.textContent==='Piece mode').click();await waitPiece(()=>document.querySelector('.piece-mode[open] cg-board'));
      window.pieceOriginal=pieceFen();window.pieceGround=document.querySelector('.piece-mode cg-board');
      pieceSelect('Maia strength','1800');pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-mode').dataset.mode==='maia');
    })()`);
    const point = (file, rank) => run(`(()=>{const b=document.querySelector('.piece-mode cg-board').getBoundingClientRect();return{x:Math.round(b.left+(${file}+.5)*b.width/8),y:Math.round(b.top+(8-${rank}+.5)*b.height/8)};})()`);
    async function click(file, rank, button = 'left') {
      const p = await point(file, rank);
      window.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...p});
      if(button==='right') await new Promise(r=>setTimeout(r,40));
      window.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,...p});
      await new Promise(r=>setTimeout(r,60));
    }
    // Illegal pawn jumps and moving the opponent's pieces are rejected.
    await click(4,2); await click(4,5);
    await run(`(async()=>{if(pieceFen().split(' ')[0]!==pieceOriginal)throw Error('Illegal pawn move was accepted');})()`);
    await click(4,7); await click(4,5);
    await run(`(async()=>{if(pieceFen().split(' ')[0]!==pieceOriginal)throw Error('Player moved the opponent pieces');})()`);
    await click(4,2); await click(4,4);
    await run(`waitPiece(()=>pieceFen().includes('/4p3/4P3/')&&pieceFen().split(' ')[1]==='w')`);
    assert.equal(requests.at(-1).rating, 1800);
    assert.deepEqual(requests.at(-1).moves, ['e2e4']);
    // User arrows and square marks are available in legal and free modes.
    const from = await point(0,2), to = await point(0,4);
    window.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...from});
    window.webContents.sendInputEvent({type:'mouseMove',button:'right',modifiers:['rightButtonDown'],...to});
    await new Promise(r=>setTimeout(r,60));
    window.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...to});
    await run(`waitPiece(()=>document.querySelector('.piece-mode svg line'))`);
    await click(1,4,'right');
    await run(`(async()=>{await waitPiece(()=>document.querySelector('.piece-mode svg circle'));pieceButton('Free mode').click();await waitPiece(()=>document.querySelector('.piece-mode').dataset.mode==='free');})()`);
    await click(4,4); await click(4,6);
    await run(`(async()=>{await waitPiece(()=>pieceFen().includes('/4P3/'));pieceButton('Reset position').click();await waitPiece(()=>pieceFen()===pieceOriginal);if(document.querySelector('.piece-mode svg line'))throw Error('Reset did not clear drawings');})()`);
    // An invalid free arrangement stays free rather than silently repairing it.
    await click(4,8); await click(4,1);
    await run(`(async()=>{pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-mode [role=alert]'));if(document.querySelector('.piece-mode').dataset.mode!=='free')throw Error('Invalid setup entered legal play');pieceButton('Reset position').click();await waitPiece(()=>pieceFen()===pieceOriginal);pieceSelect('Play as','black');pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-status').textContent.includes('thinking'));pieceButton('Reset position').click();await new Promise(r=>setTimeout(r,450));if(pieceFen()!==pieceOriginal||document.querySelector('.piece-mode').dataset.mode!=='free')throw Error('Late Maia reply changed a reset board');})()`);
    // Rating changes cancel/restart the current request without playing twice.
    await run(`(async()=>{pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-status').textContent.includes('thinking'));pieceSelect('Maia strength','2200');await waitPiece(()=>pieceFen().includes('/4P3/')&&pieceFen().split(' ')[1]==='b');if(document.querySelector('.piece-mode cg-board')!==pieceGround)throw Error('Mode switches remounted the board');pieceButton('Free mode').click();await waitPiece(()=>document.querySelector('.piece-mode').dataset.mode==='free');pieceSelect('Play as','white');pieceSelect('Side to move','white');pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-mode').dataset.mode==='maia');pieceButton('Free mode').click();pieceButton('Reset position').click();await waitPiece(()=>pieceFen()===pieceOriginal);})()`);
    assert.equal(requests.at(-1).rating, 2200);
    // Unavailable Maia leaves reset/free/return available and offers retry.
    await run(`(async()=>{window.pieceSettings=await chessEngine.settings();await chessEngine.configure({...pieceSettings,pythonPath:'/missing/maia'});pieceSelect('Play as','black');pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-mode [role=alert]'));if(!pieceButton('Retry Maia'))throw Error('Engine failure has no retry');pieceButton('Free mode').click();pieceButton('Reset position').click();await chessEngine.configure(pieceSettings);pieceButton('Return to review').click();await waitPiece(()=>!document.querySelector('.piece-mode'));if(document.querySelector('.review-board').dataset.fen!==reviewBefore)throw Error('Piece game changed review position');document.querySelector('.review-header-actions button:last-child').click();await waitPiece(()=>document.querySelectorAll('.result-item').length===2);document.querySelectorAll('.result-item')[1].click();await waitPiece(()=>document.querySelector('.review-board')?.dataset.fen);[...document.querySelectorAll('button')].find(b=>b.textContent==='Piece mode').click();await waitPiece(()=>document.querySelector('.piece-mode[open]'));pieceButton('Continue with Maia').click();await waitPiece(()=>document.querySelector('.piece-mode').dataset.mode==='maia');})()`);
    await click(0,7); await click(0,8);
    await run(`(async()=>{await waitPiece(()=>document.querySelector('.piece-mode [aria-label="Choose promotion"]'));pieceButton('knight').click();await waitPiece(()=>pieceFen().startsWith('N6k/'));await waitPiece(()=>document.querySelector('.piece-status').textContent.includes('insufficient material'));pieceButton('Reset position').click();await waitPiece(()=>pieceFen()==='7k/P7/8/8/8/8/8/7K');if(localStorage.getItem('piece-maia-rating-v1')!=='2200')throw Error('Maia strength was not saved');})()`);
    window.setSize(920,650);
    await run(`(async()=>{await new Promise(r=>setTimeout(r,100));const board=document.querySelector('.piece-mode cg-board').getBoundingClientRect(),controls=document.querySelector('.piece-mode-controls').getBoundingClientRect();if(Math.abs(board.width-board.height)>1||controls.bottom>innerHeight||board.bottom>controls.top)throw Error('Piece mode does not fit the window');})()`);
    assert.equal(hash(),original); assert.deepEqual(errors,[]);
    console.log('Piece mode desktop passed: legal Maia play, ratings, drawings, reset/free, stale replies, invalid setups, promotion, errors and source preservation.');
  } catch(error) { console.error(error); code=1; }
  finally { clearTimeout(timeout); finishDesktopTest(app,code); }
}
void smoke();
