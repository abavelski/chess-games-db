import { useEffect, useRef, useState } from 'react';
import LichessPgnViewer from '@lichess-org/pgn-viewer';

export function PgnBoard({ pgn }: { pgn: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    host.replaceChildren();
    setError(null);
    let viewer: ReturnType<typeof LichessPgnViewer> | undefined;
    try {
      viewer = LichessPgnViewer(host, {
        pgn,
        showMoves: 'bottom',
        showPlayers: false,
        showControls: true,
        scrollToMove: false,
        keyboardToMove: true,
        lichess: false,
        menu: {
          getPgn: { enabled: true },
          practiceWithComputer: { enabled: false },
          analysisBoard: { enabled: false },
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => {
      viewer?.ground?.destroy();
      host.replaceChildren();
    };
  }, [pgn]);

  return (
    <div className="pgn-area">
      {error && <div className="notice error">This PGN cannot be displayed as a board: {error}. The original PGN is still available under the PGN tab.</div>}
      <div className="viewer-host" ref={container} />
    </div>
  );
}
