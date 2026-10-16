import { createElement, useMemo, useState, type ReactNode } from 'react';
import { reviewPgn } from './pgn.mjs';
import type { GameDetail } from './types';

type Passage = { language: string; text: string };
type Chapter = { textFormat?: number; titles?: Array<{ language: string; title: string }>; contents?: Passage[] };
const cleanText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const plainProse = (text: string) => cleanText(text).replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const allowed = new Set(['p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'hr']);
const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'svg', 'math']);
// Rebuild legacy HTML as React elements. No source attributes, URLs, styles,
// handlers or executable markup ever enter the live document.
function htmlProse(text: string): ReactNode {
  const template = document.createElement('template');
  template.innerHTML = text;
  const render = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return cleanText(node.textContent || '');
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (blocked.has(tag)) return null;
    if (tag === 'img') return <span className="book-media-note" key={key}>[{node.getAttribute('alt') || 'Illustration retained in the original source'}]</span>;
    const children = [...node.childNodes].map(render);
    return allowed.has(tag) ? createElement(tag, { key }, ...children) : <span key={key}>{children}</span>;
  };
  return [...template.content.childNodes].map(render);
}

export function BookText({ game }: { game: GameDetail }) {
  const [language, setLanguage] = useState('');
  const model = useMemo(() => {
    let chapter: Chapter | undefined;
    try { chapter = JSON.parse(game.extras_json || '{}').chapterText; } catch { /* Fall back to PGN commentary. */ }
    if (chapter && Array.isArray(chapter.contents)) {
      const contents = chapter.contents.filter((p): p is Passage => typeof p?.language === 'string' && typeof p?.text === 'string');
      if (contents.length) return { chapter, contents };
    }
    let text = '';
    try { text = reviewPgn(game.pgn).tokens.filter(t => t.type === 'comment').map(t => t.text).join('\n\n'); } catch { /* Original PGN remains available. */ }
    return { chapter: undefined, contents: [{ language: 'Original', text }] };
  }, [game]);
  const passage = model.contents.find(p => p.language === language) || model.contents[0];
  const title = model.chapter?.titles?.find(t => t.language === passage.language)?.title || model.chapter?.titles?.[0]?.title;
  const prose = useMemo(() => model.chapter?.textFormat === 3 ? htmlProse(passage.text) : plainProse(passage.text), [model.chapter?.textFormat, passage.text]);
  return <article className="book-prose">
    {title && <h2>{cleanText(title)}</h2>}
    {model.contents.length > 1 && <label className="field book-language"><span>Text language</span><select value={passage.language} onChange={e => setLanguage(e.target.value)}>
      {model.contents.map(p => <option key={p.language}>{p.language}</option>)}
    </select></label>}
    {passage.text ? <div className={model.chapter?.textFormat === 3 ? 'book-html' : 'book-plain'}>{prose}</div> : <p>No readable prose was extracted. The original PGN is available below.</p>}
    <details className="book-original"><summary>Original PGN / text</summary><pre>{game.pgn}</pre></details>
  </article>;
}
