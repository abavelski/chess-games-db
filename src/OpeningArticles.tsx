import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleTarget, OpeningArticle, OpeningArticleCard, OpeningCatalog, OpeningStudySelection, ReadingBlock } from './opening-types';
import { OpeningPositionBoard } from './OpeningPositionBoard';
import { openingBoard } from './opening-session.mjs';

const emptyMoves: string[] = [];
const languageNames: Record<string, string> = { en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', ru: 'Russian', und: 'untagged' };
function OpeningDiagram({ fen }: { fen: string }) {
  const valid = useMemo(() => { try { openingBoard(fen, []); return true; } catch { return false; } }, [fen]);
  return valid ? <figure className="opening-article-diagram"><OpeningPositionBoard initialFen={fen} moves={emptyMoves} /><figcaption>Source diagram · local board</figcaption><details><summary>Diagram FEN</summary><code>{fen}</code></details></figure>
    : <p className="opening-unavailable">Source diagram unavailable: invalid or unsupported FEN.</p>;
}
function labelText(blocks: ReadingBlock[]): string {
  return blocks.filter(b => !['link','diagram','unavailable'].includes(b.type)).map(b => b.text ?? labelText(b.children ?? [])).join(' ').trim();
}
function ReadingBlocks({ blocks, targets, onArticle, onStudy, path = '' }: {
  blocks: ReadingBlock[]; targets: Map<string, ArticleTarget>; onArticle: (key: string) => void;
  onStudy: (request: OpeningStudySelection) => void; path?: string;
}) {
  const render = (children: ReadingBlock[], at: string) => <ReadingBlocks blocks={children} targets={targets} onArticle={onArticle} onStudy={onStudy} path={at} />;
  const extras = (children: ReadingBlock[], at: string): React.ReactNode => children.map((child, i) => ['link','diagram','unavailable'].includes(child.type)
    ? <Fragment key={`${at}.${i}`}>{render([child], `${at}.${i}`)}</Fragment> : extras(child.children ?? [], `${at}.${i}`));
  return <>{blocks.map((block, i) => {
    const key = `${path}.${i}`, children = block.children ?? [];
    switch (block.type) {
      case 'text': return <Fragment key={key}>{block.text}</Fragment>;
      case 'break': return <br key={key} />;
      case 'strong': return <strong key={key}>{render(children, key)}</strong>;
      case 'emphasis': return <em key={key}>{render(children, key)}</em>;
      case 'heading': return <div key={key} role="heading" aria-level={Math.min(4, Math.max(1, block.level ?? 2))} className="opening-reading-heading">{render(children, key)}</div>;
      case 'paragraph': return <div className="opening-reading-paragraph" key={key}>{render(children, key)}</div>;
      case 'quote': return <blockquote key={key}>{render(children, key)}</blockquote>;
      case 'code': return <div key={key} className="opening-reading-code">{render(children, key)}</div>;
      case 'list': return block.ordered ? <ol key={key}>{children.map((child, j) => <li key={j}>{render(child.type === 'item' ? child.children ?? [] : [child], `${key}.${j}`)}</li>)}</ol>
        : <ul key={key}>{children.map((child, j) => <li key={j}>{render(child.type === 'item' ? child.children ?? [] : [child], `${key}.${j}`)}</li>)}</ul>;
      case 'diagram': return <OpeningDiagram key={key} fen={block.fen ?? ''} />;
      case 'unavailable': return <p key={key} className="opening-unavailable">{block.text || 'Source media unavailable offline'}</p>;
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
                : <span className="opening-unavailable">{label} (unavailable)</span>}
          {extras(children, key)}
        </span>;
      }
      default: return <div key={key}>{block.text}{render(children, key)}</div>;
    }
  })}</>;
}

export function OpeningArticleReader({ catalog, articleKey, active, onArticle, onStudy, onFilter, initialScroll = 0, selectedForStudy = false }: {
  catalog: OpeningCatalog; articleKey: string; active: boolean;
  onArticle: (key: string) => void; onStudy: (request: OpeningStudySelection) => void; onFilter: (article: OpeningArticleCard) => void;
  initialScroll?: number;
  selectedForStudy?: boolean;
}) {
  const [data, setData] = useState<{ key: string; page: number; value: OpeningArticle } | null>(null), [error, setError] = useState<string | null>(null);
  const [examplesPage, setExamplesPage] = useState(1), body = useRef<HTMLDivElement>(null);
  const bodyKey = JSON.stringify([catalog.revision, articleKey]);
  const key = JSON.stringify([bodyKey, examplesPage]);
  useEffect(() => {
    if (!active) return;
    let alive = true; setError(null);
    window.openingStudy.article({ revision: catalog.revision, key: articleKey, examplesPage }).then(value => { if (alive) setData({ key: bodyKey, page: examplesPage, value }); })
      .catch(cause => { if (alive) setError(String(cause.message)); });
    return () => { alive = false; };
  }, [active, key]);
  const article = data?.key === bodyKey ? data.value : null, examplesReady = data?.page === examplesPage;
  const targets = useMemo(() => new Map(article?.targets.map(t => [t.anchor, t]) ?? []), [article]);
  const restoredScroll = useRef(false);
  useEffect(() => {
    if (article && body.current && !restoredScroll.current) { body.current.scrollTop = initialScroll; restoredScroll.current = true; }
  }, [article, initialScroll]);
  return <article className="opening-article-reader" data-reading aria-label="Opening article reader">
    {error && <p role="alert">{error}</p>}{!article && !error && <p role="status">Loading article…</p>}
    {article && <><h2>{article.title}</h2><p className="opening-provenance">{article.source} · {article.sourceLanguage || 'Language unavailable'}</p>
      {article.fallback && <p className="notice" role="status">English has no explanatory body. Showing {languageNames[article.language ?? ''] ?? article.language ?? 'available content'} ({article.sourceLanguage}).</p>}
      {!article.meaningful && <p className="notice">A reliable explanatory body could not be identified. The safe available content is shown below.</p>}
      {article.notices.some(n => n.code === 'safe_body_fallback') && <p className="notice">Some source formatting could not be separated reliably; a safe reading fallback is available.</p>}
      <button type="button" disabled={selectedForStudy} onClick={() => onFilter({ key: article.key, title: article.title, source: article.source })}>{selectedForStudy ? 'Explorer limited to this article' : 'Limit explorer to this article'}</button>
      {selectedForStudy && <p role="status">The explorer is limited to this article. Return to the article list to explore its continuations, or open a model game below.</p>}
      <div className="opening-reading-body" ref={body} data-opening-scroll data-opening-scroll-key={articleKey} tabIndex={0} aria-label="Article text">
        {article.blocks.length ? <ReadingBlocks blocks={article.blocks} targets={targets} onArticle={onArticle} onStudy={onStudy} /> : <p>No explanatory text is available in this source article.</p>}
      </div>
      <h3>Model game records</h3>{article.examples.length === 0 && <p>No playable linked examples are indexed. This essay remains available for reading.</p>}
      {!examplesReady && <p role="status">Loading examples…</p>}
      {examplesReady && article.examples.map(example => <div className="opening-material-card" key={example.key}><button type="button" onClick={() => onStudy({ key: example.key, treeHash: example.treeHash, sourcePath: '' })}>{example.white || 'Unknown'} — {example.black || 'Unknown'}</button>
        <small>{example.evidence.includes('explicit_link') ? 'Linked example' : 'Same chapter'}</small><details><summary>Why this example?</summary><p>{example.evidence.map(kind => kind === 'explicit_link' ? 'Direct source link' : 'Same source chapter').join(' · ')}</p></details></div>)}
      {article.examplesTotal > 20 && <div className="opening-pagination"><button type="button" disabled={!examplesReady || examplesPage <= 1} onClick={() => setExamplesPage(value => value - 1)}>Previous examples</button><span>Page {examplesPage}</span><button type="button" disabled={!examplesReady || examplesPage * 20 >= article.examplesTotal} onClick={() => setExamplesPage(value => value + 1)}>Next examples</button></div>}
      {article.notices.some(n => n.code === 'unavailable_example') && <p className="opening-unavailable">Some source examples are unavailable in the validated subset.</p>}
      <details><summary>Source and coverage</summary><p>Source language: {article.sourceLanguage}. Copied editions remain separate game records. Source year is provenance; this library does not claim current or complete opening theory.</p></details>
    </>}
  </article>;
}
