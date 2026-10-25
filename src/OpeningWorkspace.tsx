import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpeningLibraryStatus, OpeningStudy, OpeningStudySelection } from './opening-types';
import { OpeningExplorer } from './OpeningExplorer';
import { OpeningExamplePreview } from './OpeningExamplePreview';

export function OpeningWorkspace({ active }: { active: boolean }) {
  const [status, setStatus] = useState<OpeningLibraryStatus>({ catalog: null, path: null, error: null });
  const [opening, setOpening] = useState(false);
  const [language, setLanguage] = useState('en');
  const [epoch, setEpoch] = useState(0), [selection, setSelection] = useState<OpeningStudySelection | null>(null);
  const [studyData, setStudyData] = useState<{ key: string; value: OpeningStudy } | null>(null), [studyError, setStudyError] = useState<string | null>(null);
  const returnLocation = useRef<{ scroll: number; focus: HTMLElement | null; scrollers: Array<[HTMLElement, number]> } | null>(null);
  const selectionKey = JSON.stringify([selection, status.catalog?.revision]);
  useEffect(() => {
    if (!selection || !status.catalog) return;
    let alive = true; setStudyError(null);
    const { notice: _notice, ...request } = selection;
    window.openingStudy.study({ ...request, revision: status.catalog.revision }).then(value => { if (alive) setStudyData({ key: selectionKey, value }); })
      .catch(cause => { if (alive) setStudyError(String(cause.message)); });
    return () => { alive = false; };
  }, [selectionKey]);
  const openStudy = useCallback((request: OpeningStudySelection) => {
    returnLocation.current = { scroll: window.scrollY, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      scrollers: [...document.querySelectorAll<HTMLElement>('[data-opening-scroll]')].map(element => [element, element.scrollTop]) };
    setSelection(request); setStudyError(null);
  }, []);
  const closeStudy = () => {
    setSelection(null); setStudyData(null); setStudyError(null);
    requestAnimationFrame(() => { const saved = returnLocation.current;
      if (!saved) return; window.scrollTo(0, saved.scroll); for (const [element, scroll] of saved.scrollers) element.scrollTop = scroll;
      if (saved.focus?.isConnected) saved.focus.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    let alive = true;
    if (!window.openingStudy) { setStatus(previous => ({ ...previous, error: 'Open the desktop application to load a local library.' })); return; }
    window.openingStudy.status().then(value => { if (alive) setStatus(value); })
      .catch(error => { if (alive) setStatus(previous => ({ ...previous, error: String(error.message) })); });
    return () => { alive = false; };
  }, []);
  async function openLibrary() {
    setOpening(true);
    try {
      const result = await window.openingStudy.openLibrary();
      if (!result.canceled && result.catalog) { setStatus({ catalog: result.catalog, path: result.path ?? null, error: null }); setEpoch(value => value + 1); setSelection(null); setStudyData(null); }
    } catch (error) { setStatus(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) })); }
    finally { setOpening(false); }
  }
  return <main className="opening-workspace" aria-label="Opening study workspace" data-active={active}>
    <header className="opening-heading"><div><div className="eyebrow">OFFLINE STUDY LIBRARY</div><h1 tabIndex={-1}>Openings</h1>
      <p>Follow a move order, read the source explanations, and study annotated examples.</p></div>
      <button type="button" className="primary-button" disabled={opening} onClick={() => void openLibrary()}>{opening ? 'Opening…' : 'Open opening library'}</button></header>
    {status.error && <p className="notice error" role="alert">{status.error}</p>}
    {!status.catalog ? <section className="opening-empty"><h2>Choose an opening study library</h2>
      <p>No library is bundled. Select a ready library produced by the offline converter.</p>
      <p>Games and its selected archive stay available in their own workspace.</p>
      {status.path && <p>Remembered file: {status.path}</p>}</section>
      : <><details aria-label="Opening library information" className="opening-library-info">
        <summary>Library ready · {status.catalog.coverage.searchableDocuments.toLocaleString()} game records · {status.catalog.coverage.articles.toLocaleString()} articles</summary><p>{status.path}</p>
        <p>{status.catalog.coverage.quarantinedDocuments} quarantined records · {status.catalog.coverage.unsupportedAnnotations.toLocaleString()} unsupported annotations</p>
        <p>{status.catalog.coverage.sourceScope}</p>
      </details><div hidden={!!selection}><OpeningExplorer key={`${status.catalog.libraryUUID}:${status.catalog.revision}:${epoch}`} catalog={status.catalog} active={active && !selection} language={language} onLanguageChange={setLanguage} onOpenStudy={openStudy} /></div>
      {selection && (studyData?.key === selectionKey ? <OpeningExamplePreview study={studyData.value} notice={selection.notice} onClose={closeStudy} />
        : <section aria-label="Opening source example"><button type="button" onClick={closeStudy}>Back to study</button>{studyError ? <p role="alert">{studyError}</p> : <p role="status">Loading source example…</p>}</section>)}
      </>}
  </main>;
}
