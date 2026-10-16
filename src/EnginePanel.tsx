import { useEffect, useRef, useState } from 'react';
import { linePreview, type AnalysisPosition } from './analysis.mjs';
import type { AnalysisOptions, EngineSettings, EngineState, EngineLine } from './engine-types';
import { clearAnalysisCache } from './useEngineAnalysis';

export interface ReviewDisplay { lines: boolean; bar: boolean; arrows: boolean; maiaArrows: boolean; book: boolean }
export function readReviewPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem('review-analysis-v1') || '{}');
    return { display: { lines: stored.lines !== false, bar: stored.bar === true, arrows: stored.arrows !== false, maiaArrows: stored.maiaArrows !== false, book: stored.book !== false }, lines: [1, 3, 5].includes(stored.lineCount) ? stored.lineCount as number : 3, rating: Number.isInteger(stored.rating) && stored.rating >= 600 && stored.rating <= 2600 ? stored.rating as number : 1500 };
  } catch { return { display: { lines: true, bar: false, arrows: true, maiaArrows: true, book: true }, lines: 3, rating: 1500 }; }
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
export function EnginePanel({ options, setOptions, display, setDisplay, states, position, onPreview }: {
  options: AnalysisOptions; setOptions: React.Dispatch<React.SetStateAction<AnalysisOptions>>;
  display: ReviewDisplay; setDisplay: React.Dispatch<React.SetStateAction<ReviewDisplay>>;
  states: { stockfish: EngineState; maia: EngineState }; position: AnalysisPosition | null;
  onPreview: (moves: string[]) => void;
}) {
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('review-analysis-v1', JSON.stringify({ ...display, lineCount: options.lines, rating: options.rating })); } catch { /* Storage may be disabled. */ }
  }, [display, options.lines, options.rating]);
  const toggleDisplay = (key: keyof ReviewDisplay) => setDisplay(current => ({ ...current, [key]: !current[key] }));
  return <div className="review-analysis" aria-label="Position analysis">
    <div className="analysis-toggles">
      <Toggle label="Stockfish" value={options.stockfish} onChange={() => setOptions(current => ({ ...current, stockfish: !current.stockfish }))} />
      <Toggle label="Engine lines" value={display.lines} onChange={() => toggleDisplay('lines')} />
      <Toggle label="Evaluation bar" value={display.bar} onChange={() => toggleDisplay('bar')} />
      <Toggle label="Maia" value={options.maia} onChange={() => setOptions(current => ({ ...current, maia: !current.maia }))} />
      <button onClick={() => setSetup(true)}>Engine setup</button>
    </div>
    <details className="analysis-options"><summary>Arrows & analysis options</summary>
      <div className="analysis-toggles">
        <Toggle label="Engine arrows" value={display.arrows} onChange={() => toggleDisplay('arrows')} />
        <Toggle label="Maia arrows" value={display.maiaArrows} onChange={() => toggleDisplay('maiaArrows')} />
        <Toggle label="Book annotations" value={display.book} onChange={() => toggleDisplay('book')} />
        <label>Lines <select aria-label="Engine line count" value={options.lines} onChange={event => setOptions(current => ({ ...current, lines: Number(event.target.value) }))}>{[1, 3, 5].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <p className="analysis-legend"><span>Green: Stockfish</span> · <span>Purple: Maia</span>. Arrows show candidate first moves; width indicates rank. Scores favor White when positive.</p>
    </details>
    {options.stockfish && <section className="stockfish-analysis" aria-label="Stockfish analysis">
      <p className="engine-status" role="status">Stockfish · {states.stockfish.status}{states.stockfish.lines[0] ? ` · depth ${states.stockfish.lines[0].depth}` : ''}</p>
      {states.stockfish.error && <p className="engine-error" role="alert">{states.stockfish.error}</p>}
      {display.lines && position && states.stockfish.lines.map(line => <div className="engine-line" key={line.rank}>
        <strong>{formatScore(line.score)}</strong>
        <div>{linePreview(position, line.moves).map((item, index) => <button key={index} title={`Explore ${item.san}`} onClick={() => onPreview(item.moves)}>{item.san}</button>)}</div>
      </div>)}
    </section>}
    {options.maia && <section className="maia-analysis" aria-label="Maia predictions">
      <label>Human rating <select aria-label="Maia rating" value={options.rating} onChange={event => setOptions(current => ({ ...current, rating: Number(event.target.value) }))}>{Array.from({ length: 21 }, (_, index) => 600 + index * 100).map(rating => <option key={rating}>{rating}</option>)}</select></label>
      <p className="engine-status" role="status">Maia 3 · 79M · {states.maia.device || 'device selected in setup'} · {states.maia.status}</p>
      {states.maia.error && <p className="engine-error" role="alert">{states.maia.error}</p>}
      <div className="maia-candidates">{position && states.maia.candidates.map(candidate => <button key={candidate.move} onClick={() => onPreview([...position.moves, candidate.move])}>
        {linePreview(position, [candidate.move])[0]?.san || candidate.move} <strong>{(candidate.probability * 100).toFixed(1)}%</strong>
      </button>)}</div>
      <p className="analysis-legend">Predicted next moves at this Lichess rating. Probabilities need not sum to 100% when only top candidates are shown.</p>
    </section>}
    {setup && <EngineSetup onClose={() => setSetup(false)} onSaved={() => { clearAnalysisCache(); setOptions(current => ({ ...current, revision: current.revision + 1 })); }} />}
  </div>;
}
function EngineSetup({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    let active = true;
    void window.chessEngine.settings().then(value => { if (active) setSettings(value); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; element?.close(); };
  }, []);
  const pick = async (key: 'stockfishPath' | 'pythonPath' | 'checkpointPath') => {
    try { const value = await window.chessEngine.pick(key); if (value) setSettings(current => current ? { ...current, [key]: value } : current); }
    catch (error) { setError(String(error)); }
  };
  return <dialog ref={dialog} className="engine-setup" aria-labelledby="engine-setup-title" onCancel={onClose}>
    <form onSubmit={async event => {
      event.preventDefault(); if (!settings) return; setSaving(true); setError('');
      try { setSettings(await window.chessEngine.configure(settings)); onSaved(); onClose(); }
      catch (error) { setError(String(error)); } finally { setSaving(false); }
    }}>
      <h2 id="engine-setup-title">Local engine setup</h2>
      <p>Select installed full Stockfish and Maia 3 79M assets. Downloads and Python installation are completed in a terminal before enabling Maia; see docs/tasks/local-engine-review/SETUP.md.</p>
      {settings && <>
        {([['stockfishPath', 'Stockfish executable'], ['pythonPath', 'Maia Python executable'], ['checkpointPath', 'Maia 3 79M checkpoint']] as const).map(([key, label]) => <label key={key}>{label}<span className="engine-file"><input value={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.value })} /><button type="button" onClick={() => void pick(key)}>Choose</button></span></label>)}
        <label>Maia device <select value={settings.device} onChange={event => setSettings({ ...settings, device: event.target.value as EngineSettings['device'] })}>{['auto', 'cpu', 'mps', 'cuda'].map(device => <option key={device}>{device}</option>)}</select></label>
        {([['threads', 'Stockfish threads', 1, 128], ['hash', 'Hash memory (MB)', 16, 8192], ['budget', 'Analysis time (ms)', 100, 60000]] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" required min={min} max={max} value={settings[key]} onChange={event => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>)}
      </>}
      {error && <p role="alert" className="engine-error">{error}</p>}
      <div className="engine-setup-actions"><button type="button" onClick={onClose}>Cancel</button><button disabled={!settings || saving}>{saving ? 'Saving…' : 'Save setup'}</button></div>
    </form>
  </dialog>;
}
