import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OpeningLibraryStatus, OpeningStudy, OpeningStudySelection, OpeningUserState, OpeningExplorerState } from './opening-types';
import { OpeningExplorer } from './OpeningExplorer';
import { OpeningGameReview } from './OpeningGameReview';

export function OpeningWorkspace({ active }: { active: boolean }) {
  const [status, setStatus] = useState<OpeningLibraryStatus>({ catalog: null, path: null, error: null });
  const [opening, setOpening] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false), [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [initialExplorer, setInitialExplorer] = useState<OpeningExplorerState | undefined>();
  const [reviewFlipped, setReviewFlipped] = useState(false);
  const savedSession = useRef<OpeningUserState['session']>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.openingStudy.settings({ session: savedSession.current }).catch(cause => setSaveError(String(cause.message)));
    }, 150);
  }, []);
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); window.openingStudy.settings({ session: savedSession.current }).catch(() => {}); }
  }, []);
  const explorerState = useCallback((value: OpeningExplorerState) => {
    if (!savedSession.current) return;
    savedSession.current = { ...savedSession.current, explorer: value }; scheduleSave();
  }, [scheduleSave]);
  const reviewPosition = useCallback((sourcePath: string, flipped: boolean) => {
    const current = savedSession.current;
    if (current?.review) { savedSession.current = { ...current, review: { ...current.review, sourcePath, flipped } }; scheduleSave(); }
  }, [scheduleSave]);
  const [epoch, setEpoch] = useState(0), [selection, setSelection] = useState<OpeningStudySelection | null>(null);
  const [studyData, setStudyData] = useState<{ key: string; value: OpeningStudy } | null>(null), [studyError, setStudyError] = useState<string | null>(null);
  const returnLocation = useRef<{ scroll: number; focus: HTMLElement | null; scrollers: Array<[HTMLElement, number]> } | null>(null);
  const returning = useRef(false);
  useLayoutEffect(() => {
    if (selection || !returning.current) return;
    returning.current = false;
    const saved = returnLocation.current;
    if (!saved) return;
    window.scrollTo(0, saved.scroll);
    for (const [element, scroll] of saved.scrollers) element.scrollTop = scroll;
    if (saved.focus?.isConnected) saved.focus.focus({ preventScroll: true });
  }, [selection]);
  const selectionKey = JSON.stringify([selection, status.catalog?.revision]);
  useEffect(() => {
    if (!selection || !status.catalog) return;
    let alive = true; setStudyError(null);
    const { notice: _notice, ...request } = selection;
    window.openingStudy.study({ ...request, revision: status.catalog.revision }).then(value => { if (alive) {
      setStudyData({ key: selectionKey, value });
      if (savedSession.current) { savedSession.current = { ...savedSession.current, review: { key: value.key, treeHash: value.treeHash, sourcePath: value.matchPath, flipped: reviewFlipped } }; scheduleSave(); }
    } })
      .catch(cause => { if (alive) setStudyError(String(cause.message)); });
    return () => { alive = false; };
  }, [selectionKey]);
  const openStudy = useCallback((request: OpeningStudySelection) => {
    returnLocation.current = { scroll: window.scrollY, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      scrollers: [...document.querySelectorAll<HTMLElement>('[data-opening-scroll]')].map(element => [element, element.scrollTop]) };
    setReviewFlipped(false); setSelection(request); setStudyError(null);
  }, []);
  const closeStudy = () => {
    returning.current = true;
    setSelection(null); setStudyData(null); setStudyError(null);
    if (savedSession.current) { savedSession.current = { ...savedSession.current, review: null }; scheduleSave(); }
  };
  useEffect(() => {
    let alive = true;
    if (!window.openingStudy) { setStatus(previous => ({ ...previous, error: 'Open the desktop application to load a local library.' })); return; }
    Promise.all([window.openingStudy.status(), window.openingStudy.settings().catch(cause => {
      if (alive) setSaveError(String(cause.message)); return {} as OpeningUserState;
    })]).then(([value, settings]) => { if (alive) {
      setStatus(value);
      const c = value.catalog, s = settings.session;
      if (c) {
        if (s && s.libraryUUID === c.libraryUUID && s.revision === c.revision && s.corpus === c.corpus) {
          savedSession.current = s; setInitialExplorer(s.explorer);
          if (s.review) { setReviewFlipped(s.review.flipped); setSelection({ key: s.review.key, treeHash: s.review.treeHash, sourcePath: s.review.sourcePath }); }
        } else {
          savedSession.current = { libraryUUID: c.libraryUUID, revision: c.revision, corpus: c.corpus };
          if (s) setResumeNotice('The saved session belongs to a different library or revision. Started a new search; reading preferences are preserved.');
        }
      } else if (s) setResumeNotice('The saved opening session is retained. Reopen its library to resume.');
      setSettingsReady(true);
    } })
      .catch(error => { if (alive) setStatus(previous => ({ ...previous, error: String(error.message) })); });
    return () => { alive = false; };
  }, []);
  async function openLibrary() {
    setOpening(true);
    try {
      const result = await window.openingStudy.openLibrary();
      if (!result.canceled && result.catalog) {
        const c = result.catalog, previous = await window.openingStudy.settings().catch(() => ({} as OpeningUserState)), s = previous.session;
        const valid = s?.libraryUUID === c.libraryUUID && s?.revision === c.revision && s?.corpus === c.corpus;
        savedSession.current = valid ? s : { libraryUUID: c.libraryUUID, revision: c.revision, corpus: c.corpus };
        setInitialExplorer(valid ? s?.explorer : undefined); setReviewFlipped(valid ? s?.review?.flipped ?? false : false);
        setSelection(valid && s?.review ? { key: s.review.key, treeHash: s.review.treeHash, sourcePath: s.review.sourcePath } : null);
        setResumeNotice(s && !valid ? 'The saved session belongs to a different library or revision. Started a new search.' : null);
        setStatus({ catalog: c, path: result.path ?? null, error: null }); setEpoch(value => value + 1); setStudyData(null);
      }
    } catch (error) { setStatus(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) })); }
    finally { setOpening(false); }
  }
  return <section className={"opening-workspace" + (selection ? " reviewing-game" : "")} aria-label="Opening study workspace" data-active={active}>
    <header hidden={!!selection} className="opening-heading"><h1 tabIndex={-1}>Openings</h1>
      <button type="button" className="primary-button" disabled={opening} onClick={() => void openLibrary()}>{opening ? 'Opening…' : 'Open opening library'}</button></header>
    {status.error && <p className="notice error" role="alert">{status.error}</p>}
    {saveError && <p className="notice error" role="alert">Opening settings could not be saved: {saveError}</p>}
    {resumeNotice && <p className="notice" role="status">{resumeNotice}</p>}
    {!status.catalog ? <section className="opening-empty"><h2>Choose an opening study library</h2>
      <p>No library is bundled. Select a ready library produced by the offline converter.</p>
      <p>Games and its selected archive stay available in their own workspace.</p>
      {status.path && <p>Remembered file: {status.path}</p>}</section>
      : <><div hidden={!!selection}>{settingsReady && <OpeningExplorer key={`${status.catalog.libraryUUID}:${status.catalog.revision}:${epoch}`} initialState={initialExplorer} onState={explorerState} catalog={status.catalog} active={active && !selection} onOpenStudy={openStudy} />}</div>
      {selection && (studyData?.key === selectionKey ? <OpeningGameReview key={selectionKey} study={studyData.value} notice={selection.notice} onClose={closeStudy} active={active} initialFlipped={reviewFlipped} onPosition={reviewPosition} />
        : <section aria-label="Opening source example"><button type="button" onClick={closeStudy}>Back to study</button>{studyError ? <p role="alert">{studyError}</p> : <p role="status">Loading source example…</p>}</section>)}
      </>}
  </section>;
}
