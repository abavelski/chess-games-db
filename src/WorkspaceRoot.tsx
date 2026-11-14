import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import App from './App';
const OpeningWorkspace = lazy(() => import('./OpeningWorkspace').then(module => ({ default: module.OpeningWorkspace })));
const PersonalStudiesWorkspace = lazy(() => import('./PersonalStudiesWorkspace'));
const MaiaWorkspace = lazy(() => import('./MaiaWorkspace'));
type Workspace = 'games' | 'openings' | 'studies' | 'maia';

export default function WorkspaceRoot() {
  const [workspace, setWorkspace] = useState<Workspace>('games');
  const [openingMounted, setOpeningMounted] = useState(false);
  const [maiaMounted, setMaiaMounted] = useState(false);
  const [studiesMounted, setStudiesMounted] = useState(false);
  const focus = useRef<Partial<Record<Workspace, HTMLElement>>>({});
  const scroll = useRef({ games: 0, openings: 0, studies: 0, maia: 0 });
  const selected = useRef(false);
  useEffect(() => {
    let alive = true;
    window.openingStudy?.settings().then(state => {
      if (alive && !selected.current && state.workspace === 'openings') { setOpeningMounted(true); setWorkspace('openings'); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  function select(next: Workspace, approved = false) {
    if (workspace === 'studies' && next !== workspace && !approved && !window.dispatchEvent(new CustomEvent('personal-studies:leave', {cancelable: true, detail: () => select(next, true)}))) return;
    selected.current = true;
    if (next === workspace) return;
    // Studies resumes during this session; existing persisted games/openings choice remains intact.
    if (next === 'games' || next === 'openings') window.openingStudy?.settings({ workspace: next }).catch(() => {});
    scroll.current[workspace] = window.scrollY;
    if (next === 'openings') setOpeningMounted(true);
    if (next === 'studies') setStudiesMounted(true);
    if (next === 'maia') setMaiaMounted(true);
    setWorkspace(next);
    requestAnimationFrame(() => {
      window.scrollTo(0, scroll.current[next]);
      const target = focus.current[next];
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }
  return <div className="workspace-root" data-workspace={workspace}><nav className="workspace-navigation" aria-label="Workspaces">
    <button type="button" aria-pressed={workspace === 'games'} onClick={() => select('games')}>Games</button>
    <button type="button" aria-pressed={workspace === 'openings'} onClick={() => select('openings')}>Openings</button>
    <button type="button" aria-pressed={workspace === 'studies'} onClick={() => select('studies')}>My Studies</button>
    <button type="button" aria-pressed={workspace === 'maia'} onClick={() => select('maia')}>Maia</button>
  </nav>
    <div className="workspace-pane" hidden={workspace !== 'games'} onFocusCapture={event => { focus.current.games = event.target; }}><App active={workspace === 'games'} /></div>
    {openingMounted && <div className="workspace-pane" hidden={workspace !== 'openings'} onFocusCapture={event => { focus.current.openings = event.target; }}>
      <Suspense fallback={<p role="status">Loading opening workspace…</p>}><OpeningWorkspace active={workspace === 'openings'} /></Suspense>
    </div>}
    {studiesMounted && <div className="workspace-pane" hidden={workspace !== 'studies'} onFocusCapture={event => { focus.current.studies = event.target; }}>
      <Suspense fallback={<p role="status">Loading personal studies…</p>}><PersonalStudiesWorkspace active={workspace === 'studies'} /></Suspense>
    </div>}
    {maiaMounted && <div className="workspace-pane" hidden={workspace !== 'maia'} onFocusCapture={event => { focus.current.maia = event.target; }}>
      <Suspense fallback={<p role="status">Loading Maia…</p>}><MaiaWorkspace active={workspace === 'maia'} /></Suspense>
    </div>}
  </div>;
}
