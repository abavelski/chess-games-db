import { useEffect, useRef, useState } from 'react';
import LichessPgnViewer from '@lichess-org/pgn-viewer';
import { Path } from '@lichess-org/pgn-viewer/path';
import { prepareDisplayPgn } from './pgn.mjs';

export type Viewer = ReturnType<typeof LichessPgnViewer>;

export function PgnBoard({ pgn, review = false, initialPath = '', onReady, onPathChange, configureBoard }: {
  pgn: string; review?: boolean; initialPath?: string;
  onReady?: (viewer: Viewer | null) => void;
  onPathChange?: (path: string) => void;
  configureBoard?: (viewer: Viewer) => void;
}) {
  const activeViewer = useRef<Viewer | null>(null);
  const configure = useRef(configureBoard);
  configure.current = configureBoard;
  useEffect(() => { if (activeViewer.current) configure.current?.(activeViewer.current); }, [configureBoard]);
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    host.replaceChildren();
    setError(null);
    let viewer: Viewer | undefined;
    try {
      const mount = document.createElement('div');
      host.appendChild(mount);
      viewer = LichessPgnViewer(mount, {
        pgn: prepareDisplayPgn(pgn),
        showMoves: review ? false : 'bottom',
        showPlayers: false,
        showControls: !review,
        scrollToMove: false,
        keyboardToMove: !review,
        lichess: false,
        menu: {
          getPgn: { enabled: true },
          practiceWithComputer: { enabled: false },
          analysisBoard: { enabled: false },
        },
      });
      viewer.opts.pgn = pgn; // Keep the viewer's PGN export authoritative too.
      const go = viewer.toPath;
      viewer.toPath = (path, focus) => {
        go(path, focus);
        onPathChange?.(path.path);
        configure.current?.(viewer!);
      };
      if (initialPath && viewer.game.nodeAt(new Path(initialPath))) viewer.toPath(new Path(initialPath), false);
      const flip = viewer.flip;
      viewer.flip = () => { flip(); configure.current?.(viewer!); };
      activeViewer.current = viewer;
      onReady?.(viewer);
      configure.current?.(viewer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => {
      activeViewer.current = null;
      onReady?.(null);
      viewer?.ground?.destroy();
      host.replaceChildren();
    };
  }, [pgn, review, initialPath, onReady, onPathChange]);

  return (
    <div className="pgn-area">
      {error && <div className="notice error">This PGN cannot be displayed as a board: {error}. The original PGN is still available {review ? 'at the end of the commentary.' : 'under the PGN tab.'}</div>}
      <div className="viewer-host" ref={container} />
    </div>
  );
}
