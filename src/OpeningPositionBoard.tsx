import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chessgroundDests } from 'chessops/compat';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { openingBoard } from './opening-session.mjs';

const promotionCodes = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' } as const;
const emptyShapes: DrawShape[] = [];
export function OpeningPositionBoard({ initialFen, moves, onPlay, flipped = false, active = true, shapes = emptyShapes }: {
  initialFen: string; moves: string[]; onPlay?: (uci: string) => void; flipped?: boolean; active?: boolean; shapes?: DrawShape[];
}) {
  const board = useMemo(() => openingBoard(initialFen, moves), [initialFen, moves]);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null), queen = useRef<HTMLButtonElement>(null);
  const groundElement = useRef<HTMLDivElement>(null), ground = useRef<Api | null>(null);
  useEffect(() => { if (promotion) queen.current?.focus(); }, [promotion]);
  useEffect(() => { setPromotion(null); setError(null); }, [initialFen, moves]);
  const play = useCallback((from: string, to: string, role: keyof typeof promotionCodes = 'queen') => {
    try {
      const piece = board.position.board.get(Number(from.charCodeAt(0) - 97) + (Number(from[1]) - 1) * 8);
      const suffix = piece?.role === 'pawn' && (to[1] === '1' || to[1] === '8') ? promotionCodes[role] : '';
      onPlay?.(from + to + suffix); setPromotion(null); setError(null);
      host.current?.focus({ preventScroll: true });
    } catch (cause) { setPromotion(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [board, onPlay]);
  const configuration = useMemo<Config>(() => {
    const interactive = Boolean(onPlay && active && !promotion && board.position.hasDests());
    const last = moves.at(-1);
    return { fen: board.fen, orientation: flipped ? 'black' : 'white', turnColor: board.turn,
      animation: { enabled: !onPlay },
      check: board.position.isCheck(), viewOnly: !interactive, selected: undefined,
      lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
      movable: { free: false, color: interactive ? board.turn : undefined,
        dests: interactive ? chessgroundDests(board.position) : new Map(), events: { after: (from, to) => {
          const square = (from.charCodeAt(0) - 97) + (Number(from[1]) - 1) * 8;
          if (board.position.board.get(square)?.role === 'pawn' && (to[1] === '1' || to[1] === '8')) {
            ground.current?.set({ fen: board.fen }); setPromotion({ from, to });
          } else play(from, to);
        } } },
      draggable: { enabled: interactive }, selectable: { enabled: interactive }, premovable: { enabled: false },
      drawable: { enabled: false, autoShapes: shapes },
    };
  }, [active, board, flipped, moves, onPlay, play, promotion, shapes]);
  const latest = useRef(configuration); latest.current = configuration;
  useEffect(() => {
    const element = groundElement.current;
    if (!element) return;
    // Bind document/scroll listeners at creation even if this workspace starts
    // hidden. Later read-only/active transitions only change controlled state.
    const api = Chessground(element, { ...latest.current, viewOnly: false });
    ground.current = api; api.set(latest.current);
    return () => { api.destroy(); ground.current = null; element.replaceChildren(); };
  }, []);
  useEffect(() => {
    ground.current?.set(configuration);
    ground.current?.state.dom.bounds.clear();
    groundElement.current?.classList.toggle('manipulable', !configuration.viewOnly);
  }, [configuration]);
  return <div ref={host} className="opening-board-container" tabIndex={onPlay ? 0 : undefined} role="group" aria-label="Opening chessboard"
    data-fen={board.fen} onPointerDown={event => { if (!(event.target instanceof HTMLElement) || !event.target.closest('button')) host.current?.focus({ preventScroll: true }); }}>
    <div ref={groundElement} className="opening-ground cg-wrap" />
    {promotion && <div className="opening-promotion" role="group" aria-label="Choose opening promotion">
      <p>Promote pawn to</p>{(Object.keys(promotionCodes) as Array<keyof typeof promotionCodes>).map((role, i) =>
        <button key={role} ref={i === 0 ? queen : undefined} type="button" onClick={() => play(promotion.from, promotion.to, role)}>{role}</button>)}
      <button type="button" onClick={() => setPromotion(null)}>Cancel promotion</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
