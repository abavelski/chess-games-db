import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleTarget, OpeningArticle, OpeningCatalog, OpeningStudySelection, ReadingBlock } from './opening-types';
import { OpeningPositionBoard } from './OpeningPositionBoard';
import { OPENING_START_FEN, openingBoard } from './opening-session.mjs';

const emptyMoves: string[] = [];
const fenPattern = /((?:[prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+\s+[wb]\s+(?:[KQkq]+|-)\s+(?:[a-h][36]|-)\s+\d+\s+\d+)/g;
const languageNames: Record<string, string> = { en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', ru: 'Russian', und: 'untagged' };
function OpeningDiagram({ fen, onPosition }: { fen: string; onPosition: (fen: string) => void }) {
  const valid = useMemo(() => { try { openingBoard(fen, []); return true; } catch { return false; } }, [fen]);
  return valid ? <figure className="opening-article-diagram"><button type="button" className="opening-diagram-select" aria-label="Study diagram position" onClick={() => onPosition(fen)}><OpeningPositionBoard initialFen={fen} moves={emptyMoves} /><span>Study this position ↖</span></button><details><summary>Diagram FEN</summary><button type="button" className="opening-prose-link" onClick={() => onPosition(fen)}><code>{fen}</code></button></details></figure>
    : null;
}
function FenText({ text, onPosition }: { text: string; onPosition: (fen: string) => void }) {
  // Only offer complete, legally validated FENs; source prose stays plain text otherwise.
  const parts = text.split(fenPattern);
  return <>{parts.map((part, i) => {
    if (i % 2) {
      try { openingBoard(part, []); } catch { return <Fragment key={i}>{part}</Fragment>; }
      return <button key={i} type="button" className="opening-prose-link opening-fen-link" onClick={() => onPosition(part)} title="Set up this position on the study board">{part}</button>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  })}</>;
}
function labelText(blocks: ReadingBlock[]): string {
  return blocks.filter(b => !['link','diagram','unavailable'].includes(b.type)).map(b => b.text ?? labelText(b.children ?? [])).join(' ').trim();
}
function isHiddenPlaceholder(block: ReadingBlock): boolean {
  return block.type === 'unavailable' && /(?:invalid|unsupported) FEN|^Source image unavailable offline$/i.test((block.text ?? '').trim());
}
function hasArticleContent(blocks: ReadingBlock[], targets: Map<string, ArticleTarget>): boolean {
  return blocks.some(block => {
    if (isHiddenPlaceholder(block)) return false;
    if (block.type === 'link') {
      const target = targets.get(block.anchor ?? '');
      if (target?.status !== 'ambiguous' && !(target?.status === 'resolved' &&
        ((target.kind === 'game' && target.documentKey) || (target.kind === 'article' && target.articleKey)))) {
        // A dead navigation link is not article content, but its diagrams may be.
        return hasArticleContent((block.children ?? []).filter(child => child.type === 'diagram'), targets);
      }
      return true;
    }
    return Boolean(block.text?.trim()) || ['diagram','unavailable'].includes(block.type) || hasArticleContent(block.children ?? [], targets);
  });
}
function ReadingBlocks({ blocks, targets, onArticle, onStudy, onPosition, path = '' }: {
  blocks: ReadingBlock[]; targets: Map<string, ArticleTarget>; onArticle: (key: string) => void;
  onStudy: (request: OpeningStudySelection) => void; onPosition: (fen: string) => void; path?: string;
}) {
  const render = (children: ReadingBlock[], at: string) => <ReadingBlocks blocks={children} targets={targets} onArticle={onArticle} onStudy={onStudy} onPosition={onPosition} path={at} />;
  const extras = (children: ReadingBlock[], at: string): React.ReactNode => children.map((child, i) => ['link','diagram','unavailable'].includes(child.type)
    ? <Fragment key={`${at}.${i}`}>{render([child], `${at}.${i}`)}</Fragment> : extras(child.children ?? [], `${at}.${i}`));
  return <>{blocks.map((block, i) => {
    const key = `${path}.${i}`, children = block.children ?? [];
    switch (block.type) {
      case 'text': return <FenText key={key} text={block.text ?? ''} onPosition={onPosition} />;
      case 'break': return <br key={key} />;
      case 'strong': return <strong key={key}>{render(children, key)}</strong>;
      case 'emphasis': return <em key={key}>{render(children, key)}</em>;
      case 'heading': return <div key={key} role="heading" aria-level={Math.min(4, Math.max(1, block.level ?? 2))} className="opening-reading-heading">{render(children, key)}</div>;
      case 'paragraph': return hasArticleContent(children, targets) ? <div className="opening-reading-paragraph" key={key}>{render(children, key)}</div> : null;
      case 'quote': return <blockquote key={key}>{render(children, key)}</blockquote>;
      case 'code': return <div key={key} className="opening-reading-code">{render(children, key)}</div>;
      case 'list': return block.ordered ? <ol key={key}>{children.map((child, j) => <li key={j}>{render(child.type === 'item' ? child.children ?? [] : [child], `${key}.${j}`)}</li>)}</ol>
        : <ul key={key}>{children.map((child, j) => <li key={j}>{render(child.type === 'item' ? child.children ?? [] : [child], `${key}.${j}`)}</li>)}</ul>;
      case 'diagram': return <OpeningDiagram key={key} fen={block.fen ?? ''} onPosition={onPosition} />;
      case 'unavailable': return isHiddenPlaceholder(block) ? null : <p key={key} className="opening-unavailable">{block.text || 'Source media unavailable offline'}</p>;
      case 'link': {
        const target = targets.get(block.anchor ?? ''), label = labelText(children) || 'Source link';
        return <span key={key} className="opening-controlled-link">
          {target?.status === 'resolved' && target.kind === 'game' && target.documentKey
            ? <button type="button" className="opening-prose-link" onClick={() => onStudy({ key: target.documentKey!, treeHash: target.treeHash ?? undefined,
              sourcePath: '', notice: target.positionHint ? 'The source position hint is unvalidated; this example opens at its verified root.' : undefined })}>{label}</button>
            : target?.status === 'resolved' && target.kind === 'article' && target.articleKey
              ? <button type="button" className="opening-prose-link" onClick={() => onArticle(target.articleKey!)}>{label}</button>
              : target?.status === 'ambiguous' ? <span><strong>{label}</strong><details><summary>Choose a source example</summary>
                {target.evidence.candidates?.map((candidate, j) => <button type="button" key={candidate.stableKey ?? j} disabled={!candidate.stableKey || candidate.documentId === null}
                  onClick={() => candidate.stableKey && onStudy({ key: candidate.stableKey, treeHash: candidate.treeHash ?? undefined, sourcePath: '', notice: 'Selected from ambiguous source-link candidates; opened at the verified root.' })}>{candidate.white || candidate.black ? `${candidate.white || 'Unknown'} — ${candidate.black || 'Unknown'} · ${candidate.source}` : candidate.stableKey || 'Unavailable candidate'}</button>)}</details></span>
                : <>{labelText(children)}</>}
          {extras(children, key)}
        </span>;
      }
      default: return <div key={key}>{block.text}{render(children, key)}</div>;
    }
  })}</>;
}

export function OpeningArticleReader({ catalog, articleKey, startFen, active, onArticle, onStudy, initialScroll = 0 }: {
  catalog: OpeningCatalog; articleKey: string; active: boolean;
  onArticle: (key: string) => void; onStudy: (request: OpeningStudySelection) => void;
  initialScroll?: number; startFen: string;
}) {
  const [data, setData] = useState<{ key: string; page: number; value: OpeningArticle } | null>(null), [error, setError] = useState<string | null>(null);
  const [examplesPage, setExamplesPage] = useState(1), body = useRef<HTMLDivElement>(null);
  const [study, setStudy] = useState({ key: '', rootFen: OPENING_START_FEN, moves: emptyMoves, cursor: 0 });
  const [flipped, setFlipped] = useState(false);
  const moves = useMemo(() => study.moves.slice(0, study.cursor), [study.moves, study.cursor]);
  const board = useMemo(() => openingBoard(study.rootFen, moves), [study.rootFen, moves]);
  const bodyKey = JSON.stringify([catalog.revision, articleKey]);
  const onPosition = (fen: string) => setStudy({ key: bodyKey, rootFen: fen, moves: [], cursor: 0 });
  const key = JSON.stringify([bodyKey, examplesPage]);
  useEffect(() => {
    if (!active) return;
    let alive = true; setError(null);
    window.openingStudy.article({ revision: catalog.revision, key: articleKey, examplesPage }).then(value => {
      if (alive) {
        setData({ key: bodyKey, page: examplesPage, value });
        setStudy(current => current.key === bodyKey ? current : { key: bodyKey, rootFen: startFen, moves: [], cursor: 0 });
      }
    })
      .catch(cause => { if (alive) setError(String(cause.message)); });
    return () => { alive = false; };
  }, [active, key, startFen]);
  const article = data?.key === bodyKey ? data.value : null, examplesReady = data?.page === examplesPage;
  const targets = useMemo(() => new Map(article?.targets.map(t => [t.anchor, t]) ?? []), [article]);
  const restoredScroll = useRef(false);
  useEffect(() => {
    if (article && body.current && !restoredScroll.current) { body.current.scrollTop = initialScroll; restoredScroll.current = true; }
  }, [article, initialScroll]);
  return <article className="opening-article-reader" data-reading aria-label="Opening article reader">
    {error && <p role="alert">{error}</p>}{!article && !error && <p role="status">Loading article…</p>}
    {article && <><h2>{article.title}</h2>
      <div className="opening-article-layout">
      <aside className="opening-article-board" aria-label="Article study board">
        <OpeningPositionBoard initialFen={study.rootFen} moves={moves} flipped={flipped} active={active} onPlay={uci => setStudy(current => ({ ...current, moves: [...current.moves.slice(0, current.cursor), uci], cursor: current.cursor + 1 }))} />
        <div className="opening-board-controls">
          <button type="button" onClick={() => setFlipped(value => !value)}>Flip</button>
          <button type="button" disabled={!study.cursor} onClick={() => setStudy(current => ({ ...current, cursor: current.cursor - 1 }))}>Previous</button>
          <button type="button" disabled={study.cursor === study.moves.length} onClick={() => setStudy(current => ({ ...current, cursor: current.cursor + 1 }))}>Next</button>
          <button type="button" onClick={() => setStudy(current => ({ ...current, moves: [], cursor: 0 }))}>Reset position</button>
          <button type="button" onClick={() => onPosition(startFen)}>Starting position</button>
        </div>
        <p className="opening-board-status" role="status">{board.turn === 'white' ? 'White' : 'Black'} to move{board.position.isCheck() ? ' · Check' : ''}</p>
        {!!board.sans.length && <nav className="opening-breadcrumb" aria-label="Article board moves">{board.sans.map((san, i) => <button key={i} type="button" onClick={() => setStudy(current => ({ ...current, cursor: i + 1 }))}>{san}</button>)}</nav>}
      </aside>
      <div className="opening-reading-body" ref={body} data-opening-scroll data-opening-scroll-key={articleKey} tabIndex={0} aria-label="Article text">
      {article.fallback && <p className="notice" role="status">English has no explanatory body. Showing {languageNames[article.language ?? ''] ?? article.language ?? 'available content'} ({article.sourceLanguage}).</p>}
      {!article.meaningful && <p className="notice">A reliable explanatory body could not be identified. The safe available content is shown below.</p>}
        {article.blocks.length ? <ReadingBlocks blocks={article.blocks} targets={targets} onArticle={onArticle} onStudy={onStudy} onPosition={onPosition} /> : <p>No explanatory text is available in this source article.</p>}
      <h3>Model games</h3>{article.examples.length === 0 && <p>No playable linked examples are indexed. This essay remains available for reading.</p>}
      {!examplesReady && <p role="status">Loading examples…</p>}
      {examplesReady && article.examples.map(example => <div className="opening-material-card opening-game-card" key={example.key}>
        <button type="button" className="opening-game-open" aria-label={`Review ${example.white || 'Unknown'} — ${example.black || 'Unknown'}`} onClick={() => onStudy({ key: example.key, treeHash: example.treeHash, sourcePath: '' })} />
        <h4>{example.white || 'Unknown'} — {example.black || 'Unknown'}{example.result && example.result !== '*' ? ` · ${example.result}` : ''}</h4>
        <p>{[example.event, example.date, example.eco].filter(Boolean).join(' · ') || 'Opening study example'}</p>
        {example.annotator && <small>Annotated by {example.annotator}</small>}
      </div>)}
      {article.examplesTotal > 20 && <div className="opening-pagination"><button type="button" disabled={!examplesReady || examplesPage <= 1} onClick={() => setExamplesPage(value => value - 1)}>Previous examples</button><span>Page {examplesPage}</span><button type="button" disabled={!examplesReady || examplesPage * 20 >= article.examplesTotal} onClick={() => setExamplesPage(value => value + 1)}>Next examples</button></div>}
      {article.notices.some(n => n.code === 'unavailable_example') && <p className="opening-unavailable">Some source examples are unavailable in the validated subset.</p>}
      <details><summary>Source and coverage</summary><p>{article.source} · Source language: {article.sourceLanguage}. Copied editions remain separate game records. Source year is provenance; this library does not claim current or complete opening theory.</p></details>
      </div></div>
    </>}
  </article>;
}
