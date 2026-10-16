import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { BookText } from './BookText';
import { GameReview } from './GameReview';
import type { Book, BookContents, GameDetail } from './types';

type Start = { sourceId: number | null; key?: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function BookReader({ book, start, archivePath, onClose }: { book: Book; start: Start; archivePath: string; onClose: () => void }) {
  const [contents, setContents] = useState<BookContents | null>(null);
  const [index, setIndex] = useState(0);
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const article = useRef<HTMLDivElement>(null);
  const storageKey = `book-progress-v1:${archivePath}:${book.id}`;
  useEffect(() => {
    let alive = true;
    window.chessArchive.bookContents(book.id).then(value => {
      if (!alive) return;
      let remembered: { sourceId?: number; key?: string } | null = null;
      try { remembered = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* Storage may be unavailable. */ }
      const target = start.sourceId !== null ? start : remembered || start;
      const found = value.entries.findIndex(entry => entry.source_id === target.sourceId && (!target.key || entry.record_key === target.key));
      setIndex(Math.max(0, found)); setContents(value); setLoading(false);
    }).catch(reason => { if (alive) { setError(message(reason)); setLoading(false); } });
    return () => { alive = false; };
  }, [book.id, start, storageKey]);
  const entry = contents?.entries[index];
  const section = book.sections.find(section => section.id === entry?.source_id);
  const navigate = useCallback((next: number) => {
    if (!contents?.entries.length) return;
    setIndex(Math.max(0, Math.min(contents.entries.length - 1, next)));
  }, [contents]);
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    setGame(null); setError(null); setLoading(!!entry.game_id && entry.status !== 'failed');
    article.current?.scrollTo(0, 0);
    try { localStorage.setItem(storageKey, JSON.stringify({ sourceId: entry.source_id, key: entry.record_key })); } catch { /* Reading works without persistence. */ }
    if (entry.status !== 'failed' && entry.game_id) {
      window.chessArchive.getGame(entry.game_id).then(value => {
        if (alive) { setGame(value); if (!value) setError('This entry is no longer available.'); }
      }).catch(reason => { if (alive) setError(message(reason)); })
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [entry, storageKey]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, select, textarea, [role="textbox"]')))) return;
      if (event.key === 'Escape') onClose();
      else if (event.key === 'PageDown') navigate(index + 1);
      else if (event.key === 'PageUp') navigate(index - 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [index, navigate, onClose]);
  const chapters = useMemo(() => book.sections.map(section => ({
    ...section,
    first: contents?.entries.findIndex(entry => entry.source_id === section.id) ?? -1,
    texts: contents?.entries.flatMap((entry, index) => entry.source_id === section.id && entry.record_kind === 'text' ? [{ entry, index }] : []) || [],
  })), [book.sections, contents]);
  const activeChapter = contents?.entries.reduce((last, e, i) => i <= index && e.source_id === entry?.source_id && e.record_kind === 'text' ? i : last, -1);
  return <main className="book-reader">
    <header className="book-reader-header">
      <div><div className="eyebrow"><BookOpen size={14} /> BOOK MODE</div><h1>{book.title}</h1></div>
      <button className="secondary-button" autoFocus onClick={onClose}><ArrowLeft size={16} /> Back to library</button>
    </header>
    <div className="book-reader-layout">
      <aside className="book-contents" aria-label="Book contents">
        <h2>Contents</h2>
        {book.sections.length > 1 && <p className="hint">Sections follow an inferred order based on their names. Entries follow the original order within each section.</p>}
        {chapters.map(section => <div key={section.id}>
          <button className="book-section-link" disabled={section.first < 0} onClick={() => navigate(section.first)}>{section.label}</button>
          {section.texts.map(({ entry, index: chapterIndex }) => <button key={entry.record_key}
            className="book-chapter-link" aria-current={activeChapter === chapterIndex ? 'location' : undefined}
            onClick={() => navigate(chapterIndex)}>{entry.title}</button>)}
        </div>)}
        <p className="hint">Page Up / Page Down changes entries. Your reading place is saved on this device.</p>
      </aside>
      <div className="book-reading-pane">
        {contents && contents.entries.length > 0 && <nav className="book-navigation" aria-label="Book navigation">
          <button className="secondary-button" aria-label="Previous book entry" disabled={index === 0} onClick={() => navigate(index - 1)}><ChevronLeft size={17} /> Previous</button>
          <label className="field"><span>Entry {index + 1} of {contents.entries.length} · {section?.label}</span>
            <select aria-label="Book entry" value={index} onChange={e => navigate(Number(e.target.value))}>
              {contents.entries.map((entry, i) => <option key={`${entry.source_id}:${entry.record_key}`} value={i}>{i + 1}. {entry.title}{entry.status === 'failed' ? ' · unavailable' : ''}{entry.is_deleted ? ' · source deleted' : ''}</option>)}
            </select>
          </label>
          <button className="secondary-button" aria-label="Next book entry" disabled={index === contents.entries.length - 1} onClick={() => navigate(index + 1)}>Next <ChevronRight size={17} /></button>
        </nav>}
        <div className="book-entry-content" ref={article} aria-busy={loading}>
          {loading && <div className="details-placeholder"><RefreshCw className="spin" size={24} /> Opening book…</div>}
          {error && <div className="notice error" role="alert">{error}</div>}
          {!loading && entry && <>
            <div className="book-entry-heading">{entry.record_kind !== 'text' && <h2>{entry.title}</h2>}<div className="entry-tags"><span className="pill">{entry.record_kind}</span>
              {entry.is_training === 1 && <span className="pill training">Exercise</span>}
              {entry.is_deleted === 1 && <span className="pill deleted">Deleted in source</span>}
            </div></div>
            {entry.status === 'failed' || !entry.game_id ? <article className="book-prose"><h2>Content unavailable</h2><p>This record could not be extracted. Its place in the book is preserved.</p>{entry.error && <p className="hint">{entry.error}</p>}</article>
              : game?.record_kind === 'text' ? <BookText key={game.id} game={game} />
              : game ? <GameReview key={game.id} game={game} initialPath="" onClose={onClose} embedded /> : null}
          </>}
          {!loading && contents?.entries.length === 0 && <div className="details-placeholder">This book has no archived entries.</div>}
        </div>
      </div>
    </div>
  </main>;
}
