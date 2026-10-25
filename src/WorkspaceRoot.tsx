import { lazy, Suspense, useRef, useState } from 'react';
import App from './App';
const OpeningWorkspace = lazy(() => import('./OpeningWorkspace').then(module => ({ default: module.OpeningWorkspace })));

export default function WorkspaceRoot() {
  const [workspace, setWorkspace] = useState<'games' | 'openings'>('games');
  const [openingMounted, setOpeningMounted] = useState(false);
  const focus = useRef<Partial<Record<'games' | 'openings', HTMLElement>>>({});
  const scroll = useRef({ games: 0, openings: 0 });
  function select(next: 'games' | 'openings') {
    if (next === workspace) return;
    scroll.current[workspace] = window.scrollY;
    if (next === 'openings') setOpeningMounted(true);
    setWorkspace(next);
    requestAnimationFrame(() => {
      window.scrollTo(0, scroll.current[next]);
      const target = focus.current[next];
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }
  return <><nav className="workspace-navigation" aria-label="Workspaces">
    <button type="button" aria-pressed={workspace === 'games'} onClick={() => select('games')}>Games</button>
    <button type="button" aria-pressed={workspace === 'openings'} onClick={() => select('openings')}>Openings</button>
  </nav>
    <div className="workspace-pane" hidden={workspace !== 'games'} onFocusCapture={event => { focus.current.games = event.target; }}><App active={workspace === 'games'} /></div>
    {openingMounted && <div className="workspace-pane" hidden={workspace !== 'openings'} onFocusCapture={event => { focus.current.openings = event.target; }}>
      <Suspense fallback={<p role="status">Loading opening workspace…</p>}><OpeningWorkspace active={workspace === 'openings'} /></Suspense>
    </div>}
  </>;
}
