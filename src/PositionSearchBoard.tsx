import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search, Undo2, X } from 'lucide-react';
import { chessgroundDests } from 'chessops/compat';
import { LichessFlipIcon } from './icons/LichessFlipIcon';
import type { Key } from '@lichess-org/chessground/types';
import { PgnBoard, type Viewer } from './PgnBoard';
import { INITIAL_POSITION_FEN, positionBoard, positionNeedsPromotion, playPositionMove, type PositionSearchSetup } from './position-search-board.mjs';

const promotions = ['queen', 'rook', 'bishop', 'knight'] as const;

export function PositionSearchBoard({ setup, onSetupChange, onSearch, onClear, activeFen }: {
  setup: PositionSearchSetup;
  onSetupChange: (next: PositionSearchSetup) => void;
  onSearch: (fen: string) => void;
  onClear: () => void;
  activeFen: string | null;
}) {
  const { initialFen, moves } = setup;
  const board = useMemo(() => positionBoard(moves, initialFen), [moves, initialFen]);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fenDraft, setFenDraft] = useState<{ baseFen: string; text: string } | null>(null);
  const invalidFen = fenDraft?.baseFen === board.fen;
  const fenText = invalidFen ? fenDraft.text : board.fen;
  const promotionQueen = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (promotion) promotionQueen.current?.focus(); }, [promotion]);
  const dirty = activeFen !== null && activeFen !== board.fen;
  const update = useCallback((next: string[]) => {
    setPromotion(null); setError(null); setFenDraft(null);
    onSetupChange({ initialFen, moves: next });
  }, [onSetupChange, initialFen]);
  const makeMove = useCallback((from: string, to: string, role: typeof promotions[number] = 'queen') => {
    try { update(playPositionMove(moves, from, to, role, initialFen)); }
    catch { setError('Illegal move. Choose a highlighted destination.'); }
  }, [moves, update, initialFen]);
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
  const changeFen = (text: string) => {
    try {
      if (!text.trim()) throw new Error('Empty FEN');
      const next = positionBoard([], text.trim());
      setFenDraft(null); setPromotion(null); setError(null);
      onSetupChange({ initialFen: next.fen, moves: [] });
    } catch {
      setFenDraft({ baseFen: board.fen, text });
    }
  };
  return <section className="position-search-panel" aria-label="Search by position board">
    <div className="position-search-intro">
      <div><h3>Find games from a position</h3><p>Paste a FEN or move pieces, then select Search position. Named openings are optional; your game filters still apply.</p></div>
      <div className="position-search-actions">
        <button className="secondary-button" type="button" onClick={() => setFlipped(v => !v)}><LichessFlipIcon />Flip</button>
        <button className="secondary-button" type="button" onClick={() => update(moves.slice(0, -1))} disabled={!moves.length}><Undo2 size={15} />Undo</button>
        <button className="secondary-button" type="button" onClick={() => { setFenDraft(null); setPromotion(null); setError(null); onSetupChange({ initialFen: INITIAL_POSITION_FEN, moves: [] }); }} disabled={!moves.length && board.fen === INITIAL_POSITION_FEN && !invalidFen}><RotateCcw size={15} />Reset board</button>
      </div>
    </div>
    <div className="position-search-layout">
      <div className="position-search-board" role="group" aria-label="Position search chessboard">
        <PgnBoard pgn="*" review configureBoard={configureBoard} />
      </div>
      <div className="position-search-details">
        <p className="position-turn" role="status">{board.turn === 'white' ? 'White' : 'Black'} to move{board.position.isEnd() ? ' · Game ended' : ''}</p>
        {promotion && <div className="position-promotion" role="group" aria-label="Choose promotion piece">
          <strong>Promote pawn to</strong>
          <div>{promotions.map((role, index) =>
            <button key={role} ref={index === 0 ? promotionQueen : undefined} type="button" onClick={() => selectPromotion(role)}>{role}</button>)}
            <button type="button" onClick={() => setPromotion(null)}>Cancel</button>
          </div>
        </div>}
        {error && <p role="alert" className="position-board-error">{error}</p>}
        <label className="position-fen"><span>Position (FEN)</span>
          <textarea aria-label="Position FEN" rows={3} spellCheck={false} value={fenText}
            aria-invalid={invalidFen} aria-describedby={invalidFen ? 'position-fen-error' : undefined}
            onChange={event => changeFen(event.target.value)} />
        </label>
        {invalidFen && <p id="position-fen-error" role="alert" className="position-board-error">Enter a valid FEN with a legal chess position. The board keeps the last valid position.</p>}
        {dirty && <p className="position-search-dirty" role="status">Board changed. Search position to update the results below.</p>}
        <div className="position-search-submit">
          <button type="button" className="primary-button" disabled={invalidFen || !!promotion} onClick={() => onSearch(board.fen)}><Search size={16} />Search position</button>
          {activeFen && <button type="button" className="subtle-button" onClick={onClear}><X size={15} />Clear position search</button>}
        </div>
      </div>
    </div>
  </section>;
}
