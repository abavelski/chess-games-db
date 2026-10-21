import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftRight, RotateCcw, Search, Undo2, X } from 'lucide-react';
import {
  POSITION_FILES, positionBoard, positionLegalTargets, positionNeedsPromotion,
  positionPiece, playPositionMove,
} from './position-search-board.mjs';

const pieces: Record<string, string> = {
  'white:king': '♔', 'white:queen': '♕', 'white:rook': '♖',
  'white:bishop': '♗', 'white:knight': '♘', 'white:pawn': '♙',
  'black:king': '♚', 'black:queen': '♛', 'black:rook': '♜',
  'black:bishop': '♝', 'black:knight': '♞', 'black:pawn': '♟',
};
const promotions = ['queen', 'rook', 'bishop', 'knight'] as const;

export function PositionSearchBoard({ moves, onMovesChange, onSearch, onClear, activeFen }: {
  moves: string[];
  onMovesChange: (next: string[]) => void;
  onSearch: (fen: string) => void;
  onClear: () => void;
  activeFen: string | null;
}) {
  const board = useMemo(() => positionBoard(moves), [moves]);
  const [selected, setSelected] = useState<string | null>(null);
  const [keyboardSquare, setKeyboardSquare] = useState('e2');
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardHost = useRef<HTMLDivElement>(null);
  const promotionQueen = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (promotion) promotionQueen.current?.focus(); }, [promotion]);
  const targets = useMemo(() => selected ? positionLegalTargets(board, selected) : [], [board, selected]);
  const files = flipped ? [...POSITION_FILES].reverse() : [...POSITION_FILES];
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const dirty = activeFen !== null && activeFen !== board.fen;
  const update = (next: string[]) => {
    setSelected(null); setPromotion(null); setError(null);
    onMovesChange(next);
  };
  const makeMove = (from: string, to: string, role: typeof promotions[number] = 'queen') => {
    try { update(playPositionMove(moves, from, to, role)); }
    catch { setError('Illegal move. Choose a highlighted destination.'); }
  };
  const choose = (square: string) => {
    if (promotion) return;
    setKeyboardSquare(square);
    const piece = positionPiece(board, square);
    if (selected === square) { setSelected(null); setError(null); return; }
    if (selected && targets.includes(square)) {
      if (positionNeedsPromotion(board, selected, square)) {
        setPromotion({ from: selected, to: square });
        return;
      }
      makeMove(selected, square);
    } else if (piece && piece.color === board.turn) {
      setSelected(square); setError(null);
    } else if (selected) setError('Illegal move. Choose a highlighted destination.');
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, square: string) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setSelected(null); setError(null);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      // Roving focus includes tabIndex=-1 squares. Handle activation directly
      // rather than depending on the host platform's synthetic button click.
      event.preventDefault(); choose(square); return;
    }
    const delta: Record<string, [number, number]> = {
      ArrowRight: [flipped ? -1 : 1, 0],
      ArrowLeft: [flipped ? 1 : -1, 0],
      ArrowUp: [0, flipped ? -1 : 1],
      ArrowDown: [0, flipped ? 1 : -1],
    };
    const change = delta[event.key];
    if (!change) return;
    event.preventDefault();
    const file = POSITION_FILES.indexOf(square[0]) + change[0];
    const rank = Number(square[1]) + change[1];
    if (file < 0 || file > 7 || rank < 1 || rank > 8) return;
    const next = POSITION_FILES[file] + rank;
    setKeyboardSquare(next);
    boardHost.current?.querySelector<HTMLButtonElement>(`[data-square="${next}"]`)?.focus();
  };
  const selectPromotion = (role: typeof promotions[number]) => {
    if (promotion) makeMove(promotion.from, promotion.to, role);
  };
  return <section className="position-search-panel" aria-label="Search by position board">
    <div className="position-search-intro">
      <div><h3>Find games from a position</h3><p>Play legal moves, then select Search position. Named openings are optional; your game filters still apply.</p></div>
      <div className="position-search-actions">
        <button className="secondary-button" type="button" onClick={() => { setFlipped(v => !v); setSelected(null); }}><ArrowLeftRight size={15} />Flip</button>
        <button className="secondary-button" type="button" onClick={() => update(moves.slice(0, -1))} disabled={!moves.length}><Undo2 size={15} />Undo</button>
        <button className="secondary-button" type="button" onClick={() => update([])} disabled={!moves.length}><RotateCcw size={15} />Reset board</button>
      </div>
    </div>
    <div className="position-search-layout">
      <div className="position-search-board" ref={boardHost} role="group" aria-label="Chess position, use arrow keys to move focus and Enter or Space to select squares">
        {ranks.flatMap(rank => files.map(file => {
          const square = file + rank;
          const piece = positionPiece(board, square);
          const dark = (POSITION_FILES.indexOf(file) + rank) % 2 === 0;
          const isSelected = selected === square;
          const legal = targets.includes(square);
          return <button key={square} data-square={square} type="button"
            className={['position-square', dark ? 'dark' : 'light', isSelected ? 'selected' : '', legal ? 'legal' : ''].filter(Boolean).join(' ')}
            tabIndex={keyboardSquare === square ? 0 : -1} aria-pressed={isSelected}
            aria-label={`${square}, ${piece ? piece.color + ' ' + piece.role : 'empty'}${legal ? ', legal destination' : ''}`}
            onKeyDown={event => keyboard(event, square)} onClick={() => choose(square)}>
            <span aria-hidden="true">{piece ? pieces[`${piece.color}:${piece.role}`] : ''}</span>
            {legal && <span className="position-square-target" aria-hidden="true" />}
            {(file === files[0] || rank === ranks[7]) && <span className="position-square-coordinate" aria-hidden="true">{file === files[0] ? rank : file}</span>}
          </button>;
        }))}
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
