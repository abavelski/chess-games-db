import { useEffect, useRef, useState } from 'react';
import LichessPgnViewer from '@lichess-org/pgn-viewer';
import { makeGame } from '@lichess-org/pgn-viewer/pgn';
import { Path } from '@lichess-org/pgn-viewer/path';
import { prepareDisplayPgn } from './pgn.mjs';

export type Viewer = ReturnType<typeof LichessPgnViewer>;

export function PgnBoard({ pgn, review = false, initialPath = '', reviewPath, onReady, onPathChange, configureBoard, canSelectPath }: {
  pgn: string; review?: boolean; initialPath?: string; reviewPath?: string;
  onReady?: (viewer: Viewer | null) => void;
  onPathChange?: (path: string) => void;
  canSelectPath?: (path: string) => boolean;
  configureBoard?: (viewer: Viewer) => void;
}) {
  const latestPgn = useRef(pgn);
  latestPgn.current = pgn;
  const activeViewer = useRef<Viewer | null>(null);
  const allowed = useRef(canSelectPath);
  allowed.current = canSelectPath;
  const configure = useRef(configureBoard);
  configure.current = configureBoard;
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
        pgn: prepareDisplayPgn(latestPgn.current),
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
      viewer.opts.pgn = latestPgn.current; // Keep the viewer's PGN export authoritative too.
      const go = viewer.toPath;
      viewer.toPath = (path, focus) => {
        if (allowed.current && !allowed.current(path.path)) return;
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
  }, [review, initialPath, onReady, onPathChange]);

  useEffect(() => {
    const viewer = activeViewer.current;
    if (!viewer || viewer.opts.pgn === pgn) return;
    try {
      // Update the score without replacing Chessground or resetting its pieces.
      const game = makeGame(prepareDisplayPgn(pgn), viewer.opts.lichess);
      let target = new Path(reviewPath ?? viewer.path.path);
      while (!game.nodeAt(target) && !target.empty()) target = target.init();
      viewer.game = game;
      viewer.opts.pgn = pgn;
      viewer.toPath(target, false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [pgn, reviewPath]);

  useEffect(() => { if (activeViewer.current) configure.current?.(activeViewer.current); }, [configureBoard]);

  return (
    <div className="pgn-area">
      {error && <div className="notice error">This PGN cannot be displayed as a board: {error}. The original PGN is still available {review ? 'at the end of the commentary.' : 'under the PGN tab.'}</div>}
      <div className="viewer-host" ref={container} />
    </div>
  );
}
