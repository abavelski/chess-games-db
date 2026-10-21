import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, RotateCcw, Search, Undo2, X } from 'lucide-react';
import { chessgroundDests } from 'chessops/compat';
import type { Key } from '@lichess-org/chessground/types';
import { PgnBoard, type Viewer } from './PgnBoard';
import { positionBoard, positionNeedsPromotion, playPositionMove } from './position-search-board.mjs';

const promotions = ['queen', 'rook', 'bishop', 'knight'] as const;

export function PositionSearchBoard({ moves, onMovesChange, onSearch, onClear, activeFen }: {
  moves: string[];
  onMovesChange: (next: string[]) => void;
  onSearch: (fen: string) => void;
  onClear: () => void;
  activeFen: string | null;
}) {
  const board = useMemo(() => positionBoard(moves), [moves]);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveInput, setMoveInput] = useState('');
  const promotionQueen = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (promotion) promotionQueen.current?.focus(); }, [promotion]);
  const dirty = activeFen !== null && activeFen !== board.fen;
  const update = useCallback((next: string[]) => {
    setPromotion(null); setError(null); setMoveInput('');
    onMovesChange(next);
  }, [onMovesChange]);
  const makeMove = useCallback((from: string, to: string, role: typeof promotions[number] = 'queen') => {
    try { update(playPositionMove(moves, from, to, role)); }
    catch { setError('Illegal move. Choose a highlighted destination.'); }
  }, [moves, update]);
  const configureBoard = useCallback((viewer: Viewer) => {
    const ground = viewer.ground;
    if (!ground) return;
    const last = moves.at(-1);
    ground.set({ fen: board.fen, orientation: flipped ? 'black' : 'white',
      turnColor: board.turn, check: board.position.isCheck(), selected: undefined,
      lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
      viewOnly: false,
      movable: { free: false, color: promotion ? undefined : board.turn, dests: promotion ? new Map() : chessgroundDests(board.position),
        events: { after: (from, to) => {
          if (positionNeedsPromotion(board, from, to)) {
            ground.set({ fen: board.fen });
            setPromotion({ from, to });
          } else makeMove(from, to);
        } } },
      draggable: { enabled: !promotion }, selectable: { enabled: !promotion },
      premovable: { enabled: false }, drawable: { enabled: false },
    });
  }, [board, moves, flipped, promotion, makeMove]);
  const selectPromotion = (role: typeof promotions[number]) => {
    if (promotion) makeMove(promotion.from, promotion.to, role);
  };
  const playTypedMove = () => {
    const move = moveInput.trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
      setError('Enter a move such as e2e4 or e7e8q.'); return;
    }
    const from = move.slice(0, 2), to = move.slice(2, 4);
    if (!move[4] && positionNeedsPromotion(board, from, to)) { setPromotion({ from, to }); return; }
    const roles: Record<string, typeof promotions[number]> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
    makeMove(from, to, roles[move[4]] ?? 'queen');
  };
  return <section className="position-search-panel" aria-label="Search by position board">
    <div className="position-search-intro">
      <div><h3>Find games from a position</h3><p>Play legal moves, then select Search position. Named openings are optional; your game filters still apply.</p></div>
      <div className="position-search-actions">
        <button className="secondary-button" type="button" onClick={() => { setFlipped(v => !v); }}><ArrowLeftRight size={15} />Flip</button>
        <button className="secondary-button" type="button" onClick={() => update(moves.slice(0, -1))} disabled={!moves.length}><Undo2 size={15} />Undo</button>
        <button className="secondary-button" type="button" onClick={() => update([])} disabled={!moves.length}><RotateCcw size={15} />Reset board</button>
      </div>
    </div>
    <div className="position-search-layout">
      <div className="position-search-board" role="group" aria-label="Position search chessboard">
        <PgnBoard pgn="*" review configureBoard={configureBoard} />
      </div>
      <div className="position-search-details">
        <p className="position-turn" role="status">{board.turn === 'white' ? 'White' : 'Black'} to move{board.position.isEnd() ? ' · Game ended' : ''}</p>
        <div className="position-move-history">
          <strong>Moves</strong>
          <div aria-label="Position move history" className="position-move-list">
            {board.sans.length ? board.sans.map((san, i) =>
              <span key={i}>{i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{san}</span>) :
              <span className="position-no-moves">Starting position</span>}
          </div>
        </div>
        <form className="position-keyboard-move" onSubmit={event => { event.preventDefault(); playTypedMove(); }}>
          <label className="field"><span>Move by coordinates</span><input value={moveInput} placeholder="e2e4" autoComplete="off"
            disabled={!!promotion} onChange={event => setMoveInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); playTypedMove(); } }} /></label>
          <button className="secondary-button" type="submit" disabled={!!promotion || !moveInput.trim()}>Play move</button>
        </form>
        {promotion && <div className="position-promotion" role="group" aria-label="Choose promotion piece">
          <strong>Promote pawn to</strong>
          <div>{promotions.map((role, index) =>
            <button key={role} ref={index === 0 ? promotionQueen : undefined} type="button" onClick={() => selectPromotion(role)}>{role}</button>)}
            <button type="button" onClick={() => setPromotion(null)}>Cancel</button>
          </div>
        </div>}
        {error && <p role="alert" className="position-board-error">{error}</p>}
        <div className="position-fen"><span>Position (FEN)</span><output aria-label="Position FEN">{board.fen}</output></div>
        {dirty && <p className="position-search-dirty" role="status">Board changed. Search position to update the results below.</p>}
        <div className="position-search-submit">
          <button type="button" className="primary-button" onClick={() => onSearch(board.fen)}><Search size={16} />Search position</button>
          {activeFen && <button type="button" className="subtle-button" onClick={onClear}><X size={15} />Clear position search</button>}
        </div>
      </div>
    </div>
  </section>;
}
