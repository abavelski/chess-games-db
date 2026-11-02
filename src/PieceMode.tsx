import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare } from 'chessops/util';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { Candidate } from './engine-types';
import { appendMove, type AnalysisPosition } from './analysis.mjs';
import { chooseMaiaMove, pieceGameResult, startPieceGame } from './piece-game.mjs';

type Color = 'white' | 'black';
type Promotion = { from: string; to: string };
const ratingKey = 'piece-maia-rating-v1';
let sequence = 0;
function savedRating() {
  try { const rating = Number(localStorage.getItem(ratingKey)); return rating >= 600 && rating <= 2600 && rating % 100 === 0 ? rating : 1500; }
  catch { return 1500; }
}

// All review entry points share this sandbox. Returning never changes the score.
export function PieceMode({ fen, orientation, onReturn }: { fen: string; orientation: Color; onReturn: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), host = useRef<HTMLDivElement>(null);
  const ground = useRef<Api | null>(null), touched = useRef(new Set<number>());
  const freeBase = useRef(fen);
  const sessionEpoch = useRef(0);
  const [pieces, setPieces] = useState(fen.split(' ')[0]);
  const [mode, setMode] = useState<'free' | 'maia'>('free');
  const [turn, setTurn] = useState<Color>(fen.split(' ')[1] === 'b' ? 'black' : 'white');
  const [human, setHuman] = useState<Color>(turn), [rating, setRating] = useState(savedRating);
  const [game, setGame] = useState<AnalysisPosition | null>(null), [promotion, setPromotion] = useState<Promotion | null>(null);
  const [error, setError] = useState<string | null>(null), [thinking, setThinking] = useState(false);
  const [retry, setRetry] = useState(0), [claimedDraw, setClaimedDraw] = useState(false);
  const result = useMemo(() => game ? pieceGameResult(game) : null, [game]);
  const ended = claimedDraw || result?.ended;
  const humanTurn = mode === 'maia' && game?.turn === human && !ended && !promotion;
  const callbacks = useRef<{ move: (from: Key, to: Key) => void; change: () => void }>({ move: () => {}, change: () => {} });
  const queen = useRef<HTMLButtonElement>(null);

  const play = (from: string, to: string, role: 'queen' | 'rook' | 'bishop' | 'knight' = 'queen') => {
    if (!game || mode !== 'maia' || game.turn !== human || ended) return;
    try { setGame(appendMove(game, from, to, role)); setPromotion(null); setError(null); }
    catch { ground.current?.set({ fen: game.fen }); setError('That move is not legal in this position.'); }
  };
  callbacks.current = {
    move: (from, to) => {
      if (mode === 'free') { touched.current.add(parseSquare(from)!); touched.current.add(parseSquare(to)!); return; }
      if (!humanTurn || !game) { if (game) ground.current?.set({ fen: game.fen }); return; }
      if (game.position.board.get(parseSquare(from)!)?.role === 'pawn' && (to[1] === '1' || to[1] === '8')) {
        ground.current?.set({ fen: game.fen }); setPromotion({ from, to });
      } else play(from, to);
    },
    change: () => { if (mode === 'free' && ground.current) setPieces(ground.current.getFen()); },
  };

  useEffect(() => { if (promotion) queen.current?.focus(); }, [promotion]);
  useEffect(() => { try { localStorage.setItem(ratingKey, String(rating)); } catch { /* Optional preference. */ } }, [rating]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (host.current) ground.current = Chessground(host.current, {
      fen, orientation, coordinates: false, autoCastle: false, animation: { enabled: false },
      movable: { free: true, color: 'both', showDests: false, events: { after: (from, to) => callbacks.current.move(from, to) } },
      premovable: { enabled: false }, draggable: { enabled: true, showGhost: false, deleteOnDropOff: false },
      selectable: { enabled: true }, highlight: { lastMove: false, check: false },
      drawable: { enabled: true, visible: true }, events: { change: () => callbacks.current.change() },
    });
    return () => { ground.current?.destroy(); ground.current = null; element?.close(); };
  }, [fen, orientation]);

  useEffect(() => {
    const board = ground.current;
    if (!board) return;
    if (mode === 'free') {
      board.set({ autoCastle: false, check: false, lastMove: undefined, selected: undefined,
        movable: { free: true, color: 'both', showDests: false, dests: new Map() },
        draggable: { enabled: true }, selectable: { enabled: true }, highlight: { check: false, lastMove: false } });
    } else if (game) {
      const last = game.moves.at(-1);
      board.set({ fen: game.fen, autoCastle: true, turnColor: game.turn,
        drawable: { shapes: board.state.drawable.shapes },
        check: game.position.isCheck(), lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
        selected: undefined, movable: { free: false, color: humanTurn ? human : undefined, showDests: true,
          dests: humanTurn ? chessgroundDests(game.position) : new Map() },
        draggable: { enabled: Boolean(humanTurn) }, selectable: { enabled: Boolean(humanTurn) }, highlight: { check: true, lastMove: true } });
    }
  }, [mode, game, human, humanTurn]);

  // Cleanup invalidates late replies before reset, changing strength or closing.
  useEffect(() => {
    if (mode !== 'maia' || !game || game.turn === human || ended) { setThinking(false); return; }
    const api = window.chessEngine;
    if (!api) { setError('Maia is unavailable. Return to free mode or configure Maia in engine settings.'); return; }
    let alive = true, finished = false;
    const epoch = sessionEpoch.current;
    let candidates: Candidate[] = [];
    const id = `piece-maia-${Date.now()}-${++sequence}`;
    setThinking(true); setError(null);
    const fail = (message: string) => { if (alive && !finished && epoch === sessionEpoch.current) { finished = true; setError(message); setThinking(false); } };
    const unsubscribe = api.onUpdate(event => {
      if (!alive || finished || epoch !== sessionEpoch.current || event.engine !== 'maia' || event.id !== id) return;
      if (event.candidates) candidates = event.candidates;
      if (event.status === 'error') fail(event.error || 'Maia could not choose a move.');
      if (event.status === 'complete') {
        try { const next = chooseMaiaMove(game, candidates); finished = true; setGame(next); setThinking(false); }
        catch (cause) { fail(cause instanceof Error ? cause.message : String(cause)); }
      }
    });
    void api.analyze({ id, engine: 'maia', initialFen: game.initialFen, moves: game.moves,
      turn: game.turn, lines: 5, rating }).catch(cause => fail(cause instanceof Error ? cause.message : String(cause)));
    return () => { alive = false; unsubscribe(); void api.stop('maia').catch(() => {}); };
  }, [mode, game, human, rating, retry, ended]);

  const start = () => {
    try {
      const next = startPieceGame(freeBase.current, ground.current?.getFen() ?? pieces, turn, [...touched.current]);
      sessionEpoch.current++; setGame(next);
      setMode('maia'); setError(null); setPromotion(null); setClaimedDraw(false);
    } catch { setError('This setup cannot start a legal game. Check both kings, the side to move and pawn placement, or reset the position.'); }
  };
  const free = () => {
    sessionEpoch.current++;
    if (game) {
      setPieces(game.fen.split(' ')[0]); setTurn(game.turn);
      freeBase.current = game.fen; touched.current.clear();
    }
    setMode('free'); setPromotion(null); setError(null); setClaimedDraw(false);
  };
  const reset = () => {
    sessionEpoch.current++;
    setMode('free'); setGame(null); setPromotion(null); setError(null); setClaimedDraw(false); setThinking(false);
    freeBase.current = fen; touched.current.clear(); setPieces(fen.split(' ')[0]); setTurn(fen.split(' ')[1] === 'b' ? 'black' : 'white');
    ground.current?.cancelMove(); ground.current?.selectSquare(null);
    ground.current?.set({ fen, lastMove: undefined, check: false }); ground.current?.setShapes([]);
  };
  const close = () => { sessionEpoch.current++; onReturn(); };
  return <dialog ref={dialog} className="piece-mode" aria-label="Piece mode" data-mode={mode} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="piece-board-area"><div className="piece-board cg-wrap" ref={host} data-fen={mode === 'maia' ? game?.fen : pieces} /></div>
    <div className="piece-mode-controls">
      <div className="piece-actions">
        <label>Maia strength<select aria-label="Maia strength" value={rating} onChange={event => {
          const next = Number(event.target.value);
          if (next !== rating) { sessionEpoch.current++; setRating(next); }
        }}>
          {Array.from({ length: 21 }, (_, i) => 600 + i * 100).map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Play as<select aria-label="Play as" value={human} disabled={mode === 'maia'} onChange={event => setHuman(event.target.value as Color)}><option value="white">White</option><option value="black">Black</option></select></label>
        {mode === 'free' && <label>Side to move<select aria-label="Side to move" value={turn} onChange={event => setTurn(event.target.value as Color)}><option value="white">White</option><option value="black">Black</option></select></label>}
        {mode === 'free' ? <button type="button" onClick={start}>Continue with Maia</button> : <button type="button" onClick={free}>Free mode</button>}
        <button type="button" onClick={reset}>Reset position</button>
        <button type="button" onClick={() => ground.current?.setShapes([])}>Clear drawings</button>
        <button type="button" autoFocus onClick={close}>Return to review</button>
      </div>
      <p className="piece-status" role="status">{mode === 'free' ? 'Free mode — move either side without chess rules.' : claimedDraw ? 'Draw claimed.' : ended ? result?.text : thinking ? `Maia ${rating} is thinking…` : `${result?.text} You play ${human === 'white' ? 'White' : 'Black'}.`}</p>
      {promotion && <div className="piece-actions" role="group" aria-label="Choose promotion">Promote to {(['queen', 'rook', 'bishop', 'knight'] as const).map((role, i) => <button key={role} ref={i === 0 ? queen : undefined} onClick={() => play(promotion.from, promotion.to, role)}>{role}</button>)}<button onClick={() => { setPromotion(null); ground.current?.set({ fen: game!.fen }); }}>Cancel</button></div>}
      {mode === 'maia' && !ended && game?.turn === human && result?.claim && <button onClick={() => setClaimedDraw(true)}>Claim draw ({result.claim})</button>}
      {error && <p className="engine-error" role="alert">{error} {mode === 'maia' && game?.turn !== human && <button onClick={() => setRetry(value => value + 1)}>Retry Maia</button>}</p>}
      <p className="piece-drawing-help">Right-drag to draw arrows; right-click to mark a square. Shift, Alt or Ctrl changes the color.</p>
    </div>
  </dialog>;
}
