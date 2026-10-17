import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { LichessFlipIcon } from './icons/LichessFlipIcon';
import { linePreview, type AnalysisPosition } from './analysis.mjs';
import type { AnalysisOptions, EngineState, EngineLine } from './engine-types';

export interface ReviewDisplay { lines: boolean; maiaLines: boolean; bar: boolean; arrows: boolean; maiaArrows: boolean; book: boolean }
export function readReviewPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem('review-analysis-v1') || '{}');
    return { display: { lines: stored.lines !== false, maiaLines: stored.maiaLines !== false, bar: stored.bar === true, arrows: stored.arrows !== false, maiaArrows: stored.maiaArrows !== false, book: stored.book !== false }, lines: [1, 3, 5].includes(stored.lineCount) ? stored.lineCount as number : 3, maiaLines: [1, 3, 5].includes(stored.maiaLineCount) ? stored.maiaLineCount as number : 5, rating: Number.isInteger(stored.rating) && stored.rating >= 600 && stored.rating <= 2600 ? stored.rating as number : 1500 };
  } catch { return { display: { lines: true, maiaLines: true, bar: false, arrows: true, maiaArrows: true, book: true }, lines: 3, maiaLines: 5, rating: 1500 }; }
}
export function formatScore(score?: EngineLine['score']) {
  if (!score) return '—';
  const prefix = score.bound === 'lowerbound' ? '≥' : score.bound === 'upperbound' ? '≤' : '';
  return prefix + (score.type === 'mate' ? `#${score.value}` : `${score.value >= 0 ? '+' : ''}${(score.value / 100).toFixed(2)}`);
}
export function EvaluationBar({ state, enabled, flipped }: { state: EngineState; enabled: boolean; flipped: boolean }) {
  const score = enabled ? state.lines[0]?.score : undefined;
  const value = score ? score.type === 'mate' ? (score.winner ? score.winner === 'white' ? 100 : 0 : score.value >= 0 ? 100 : 0) : 100 / (1 + Math.exp(-score.value / 350)) : 50;
  return <div className={'evaluation-bar' + (flipped ? ' flipped' : '')} aria-label={`Stockfish evaluation from White's perspective: ${formatScore(score)}`} title={`White evaluation ${formatScore(score)} · ${enabled ? state.status : 'Stockfish off'}`}>
    <div className="evaluation-white" style={{ height: `${value}%` }} />
    <span>{formatScore(score)}</span>
  </div>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return <button type="button" aria-pressed={value} onClick={onChange}>{label}</button>;
}
export function EnginePanel({ options, setOptions, display, setDisplay, states, position, onPreview, onFlip, canFlip }: {
  options: AnalysisOptions; setOptions: React.Dispatch<React.SetStateAction<AnalysisOptions>>;
  display: ReviewDisplay; setDisplay: React.Dispatch<React.SetStateAction<ReviewDisplay>>;
  states: { stockfish: EngineState; maia: EngineState }; position: AnalysisPosition | null;
  onPreview: (moves: string[]) => void; onFlip: () => void; canFlip: boolean;
}) {
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('review-analysis-v1', JSON.stringify({ ...display, lineCount: options.lines, maiaLineCount: options.maiaLines, rating: options.rating })); } catch { /* Storage may be disabled. */ }
  }, [display, options.lines, options.maiaLines, options.rating]);
  return <div className="review-analysis" aria-label="Position analysis">
    <div className="analysis-toggles">
      <button className="review-settings-button" onClick={() => setSetup(true)} aria-label="Game review settings" title="Game review settings" aria-haspopup="dialog"><Settings size={17} aria-hidden="true" /></button>
      <Toggle label="Stockfish" value={options.stockfish} onChange={() => setOptions(current => ({ ...current, stockfish: !current.stockfish }))} />
      <Toggle label="Maia" value={options.maia} onChange={() => setOptions(current => ({ ...current, maia: !current.maia }))} />
    </div>
    {options.stockfish && <section className="stockfish-analysis" aria-label="Stockfish analysis">
      <p className="engine-status" role="status">Stockfish · {states.stockfish.status}{states.stockfish.lines[0] ? ` · depth ${states.stockfish.lines[0].depth}` : ''}</p>
      {states.stockfish.error && <p className="engine-error" role="alert">{states.stockfish.error}</p>}
      {display.lines && position && states.stockfish.lines.slice(0, options.lines).map(line => <div className="engine-line" key={line.rank}>
        <strong>{formatScore(line.score)}</strong>
        <div>{linePreview(position, line.moves).map((item, index) => <button key={index} title={`Explore ${item.san}`} onClick={() => onPreview(item.moves)}>{item.san}</button>)}</div>
      </div>)}
    </section>}
    {options.maia && <section className="maia-analysis" aria-label="Maia predictions">
      <p className="engine-status" role="status">Maia · {options.rating} · {states.maia.status}</p>
      {states.maia.error && <p className="engine-error" role="alert">{states.maia.error}</p>}
      <div className="maia-candidates">{display.maiaLines && position && states.maia.candidates.slice(0, options.maiaLines).map(candidate => <button key={candidate.move} onClick={() => onPreview([...position.moves, candidate.move])}>
        {linePreview(position, [candidate.move])[0]?.san || candidate.move} <strong>{(candidate.probability * 100).toFixed(1)}%</strong>
      </button>)}</div>
    </section>}
    {setup && <ReviewPreferences options={options} setOptions={setOptions} display={display} setDisplay={setDisplay} onClose={() => setSetup(false)} onFlip={onFlip} canFlip={canFlip} />}
  </div>;
}
function ReviewPreferences({ options, setOptions, display, setDisplay, onClose, onFlip, canFlip }: {
  options: AnalysisOptions; setOptions: React.Dispatch<React.SetStateAction<AnalysisOptions>>;
  display: ReviewDisplay; setDisplay: React.Dispatch<React.SetStateAction<ReviewDisplay>>;
  onClose: () => void; onFlip: () => void; canFlip: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    return () => element?.close();
  }, []);
  const checkbox = (key: keyof ReviewDisplay, label: string) => <label className="engine-preference-check">
    <input type="checkbox" checked={display[key]} onChange={event => setDisplay(current => ({ ...current, [key]: event.target.checked }))} />{label}
  </label>;
  const lineCount = (key: 'lines' | 'maiaLines', label: string) => <label>{label}<select aria-label={label} value={options[key]} onChange={event => setOptions(current => ({ ...current, [key]: Number(event.target.value) }))}>
    {[1, 3, 5].map(value => <option key={value}>{value}</option>)}
  </select></label>;
  return <dialog ref={dialog} className="engine-setup" aria-labelledby="review-settings-title" onCancel={onClose}>
    <h2 id="review-settings-title">Game review settings</h2>
    <button className="review-flip-button" onClick={onFlip} disabled={!canFlip} aria-label="Flip board" title="Flip board (F)"><LichessFlipIcon />Flip board</button>
    <div className="engine-preferences-grid"><fieldset><legend>Stockfish</legend>
      {checkbox('lines', 'Stockfish lines')}
      {lineCount('lines', 'Stockfish line count')}
      {checkbox('arrows', 'Stockfish arrows')}
      {checkbox('bar', 'Evaluation bar')}
    </fieldset>
    <fieldset><legend>Maia</legend>
      {checkbox('maiaLines', 'Maia lines')}
      {lineCount('maiaLines', 'Maia line count')}
      {checkbox('maiaArrows', 'Maia arrows')}
      <label>Human rating<select aria-label="Maia rating" value={options.rating} onChange={event => setOptions(current => ({ ...current, rating: Number(event.target.value) }))}>
        {Array.from({ length: 21 }, (_, index) => 600 + index * 100).map(rating => <option key={rating}>{rating}</option>)}
      </select></label>
    </fieldset>
    </div>
    {checkbox('book', 'Book annotations')}
    <p className="analysis-legend"><span>Green: Stockfish</span> · <span>Purple: Maia</span>. Arrows show candidate first moves. Positive evaluation favors White.</p>
    <div className="engine-setup-actions"><button autoFocus onClick={onClose}>Done</button></div>
  </dialog>;
}
