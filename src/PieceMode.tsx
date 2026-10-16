import { useEffect, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';

// A separate board deliberately has no chess rules, PGN tree, or engine API.
export function PieceMode({ fen, orientation, onReturn }: { fen: string; orientation: 'white' | 'black'; onReturn: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const ground = useRef<Api | null>(null);
  const [pieces, setPieces] = useState(fen.split(' ')[0]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (host.current) {
      const board = Chessground(host.current, {
        fen, orientation, coordinates: false, autoCastle: false,
        animation: { enabled: false },
        movable: { free: true, color: 'both', showDests: false },
        premovable: { enabled: false },
        draggable: { enabled: true, showGhost: false, deleteOnDropOff: false },
        selectable: { enabled: true },
        highlight: { lastMove: false, check: false },
        drawable: { enabled: false, visible: false },
        events: { change: () => setPieces(board.getFen()) },
      });
      ground.current = board;
    }
    return () => { ground.current?.destroy(); ground.current = null; element?.close(); };
  }, [fen, orientation]);
  return <dialog ref={dialog} className="piece-mode" aria-label="Piece mode" onCancel={event => { event.preventDefault(); onReturn(); }}>
    <div className="piece-board" ref={host} data-fen={pieces} />
    <div className="piece-actions">
      <button onClick={() => { ground.current?.cancelMove(); ground.current?.selectSquare(null); ground.current?.set({ fen, lastMove: undefined, check: false }); setPieces(fen.split(' ')[0]); }}>Reset position</button>
      <button autoFocus onClick={onReturn}>Return to review</button>
    </div>
  </dialog>;
}
