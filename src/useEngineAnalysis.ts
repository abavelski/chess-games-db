import { useEffect, useRef, useState } from 'react';
import { analysisKey, type AnalysisPosition } from './analysis.mjs';
import type { AnalysisOptions, EngineName, EngineState, EngineLine } from './engine-types';

const empty = (): EngineState => ({ status: 'off', lines: [], candidates: [] });
// Memory-only cache, scoped to this application run. Completed results only.
const cache = new Map<string, EngineState>();
export function useEngineAnalysis(position: AnalysisPosition | null, options: AnalysisOptions, paused = false) {
  const [state, setState] = useState<Record<EngineName, EngineState>>({ stockfish: empty(), maia: empty() });
  const sequence = useRef(0);
  const positionKey = position ? JSON.stringify([position.initialFen, position.moves]) : '';
  useEffect(() => {
    const api = window.chessEngine;
    if (!api) return;
    const ids = new Map<EngineName, string>();
    const snapshots = new Map<EngineName, EngineState>();
    const keys = new Map<EngineName, string>();
    const unsubscribe = api.onUpdate(event => {
      if (ids.get(event.engine) !== event.id) return;
      const previous = snapshots.get(event.engine) || empty();
      const next: EngineState = { ...previous, status: event.status, error: event.error };
      if (event.moves && event.score && event.rank) {
        const line = event as EngineLine;
        next.lines = [...previous.lines.filter(item => item.rank !== line.rank), line].sort((a, b) => a.rank - b.rank);
      }
      if (event.candidates) next.candidates = event.candidates;
      if (event.device) next.device = event.device;
      snapshots.set(event.engine, next);
      setState(current => ({ ...current, [event.engine]: next }));
      if (event.status === 'complete') {
        cache.set(keys.get(event.engine)!, next);
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
      }
    });
    setState({ stockfish: { ...empty(), status: paused ? 'paused' : 'off' }, maia: { ...empty(), status: paused ? 'paused' : 'off' } });
    const timer = setTimeout(() => {
      if (!position || paused) return;
      for (const engine of ['stockfish', 'maia'] as const) {
        if (!options[engine]) continue;
        const key = analysisKey(position, engine, { revision: options.revision, lines: options.lines, rating: engine === 'maia' ? options.rating : undefined });
        keys.set(engine, key);
        const cached = cache.get(key);
        if (cached) { setState(current => ({ ...current, [engine]: cached })); continue; }
        const id = `${Date.now()}-${++sequence.current}-${engine}`;
        ids.set(engine, id);
        void api.analyze({ id, engine, initialFen: position.initialFen, moves: position.moves, turn: position.turn, lines: options.lines, rating: options.rating }).catch(error => {
          if (ids.get(engine) === id) setState(current => ({ ...current, [engine]: { ...empty(), status: 'error', error: String(error.message || error) } }));
        });
      }
    }, 180);
    return () => {
      clearTimeout(timer); ids.clear(); unsubscribe();
      for (const engine of ['stockfish', 'maia'] as const) void api.stop(engine).catch(() => {});
    };
  // Position snapshots are immutable and fully identified by their initial FEN/history.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey, options.stockfish, options.maia, options.lines, options.rating, options.revision, paused]);
  return state;
}
