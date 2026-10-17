import { useEffect, useState } from 'react';
import { analysisKey, type AnalysisPosition } from './analysis.mjs';
import type { AnalysisOptions, EngineName, EngineState, EngineLine } from './engine-types';

const empty = (status = 'off'): EngineState => ({ status, lines: [], candidates: [] });
const cache = new Map<string, EngineState>();
let sequence = 0;
export function clearAnalysisCache() { cache.clear(); }
function useOneEngine(position: AnalysisPosition | null, engine: EngineName, enabled: boolean, lines: number, rating: number, revision: number, paused: boolean) {
  const key = position ? analysisKey(position, engine, { revision, lines, rating }) : '';
  const renderKey = JSON.stringify([key, enabled, paused]);
  const idle = paused ? 'paused' : enabled && position ? 'loading' : 'off';
  const [result, setResult] = useState<{ key: string; value: EngineState }>({ key: renderKey, value: empty(idle) });
  useEffect(() => {
    const api = window.chessEngine;
    if (!api || !position || !enabled || paused) {
      setResult({ key: renderKey, value: empty(idle) });
      return;
    }
    let active = true;
    let snapshot = empty('loading');
    const id = `${Date.now()}-${++sequence}-${engine}`;
    const unsubscribe = api.onUpdate(event => {
      if (!active || event.id !== id || event.engine !== engine) return;
      snapshot = { ...snapshot, status: event.status, error: event.error };
      if (event.moves && event.score && event.rank) {
        const line = event as EngineLine;
        snapshot.lines = [...snapshot.lines.filter(item => item.rank !== line.rank), line].sort((a, b) => a.rank - b.rank);
      }
      if (event.candidates) snapshot.candidates = event.candidates;
      if (event.device) snapshot.device = event.device;
      setResult({ key: renderKey, value: snapshot });
      if (event.status === 'complete') {
        cache.set(key, snapshot);
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
      }
    });
    const cached = cache.get(key);
    setResult({ key: renderKey, value: cached || snapshot });
    const timer = setTimeout(() => {
      if (cached) return;
      void api.analyze({ id, engine, initialFen: position.initialFen, moves: position.moves, turn: position.turn, lines, rating }).catch(error => {
        if (active) setResult({ key: renderKey, value: { ...empty('error'), error: String(error.message || error) } });
      });
    }, 180);
    return () => { active = false; clearTimeout(timer); unsubscribe(); void api.stop(engine).catch(() => {}); };
    // Immutable position is fully identified by initial FEN and move history in key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);
  // Never display a previous position's score/arrows while effects catch up.
  return result.key === renderKey ? result.value : empty(idle);
}
export function useEngineAnalysis(position: AnalysisPosition | null, options: AnalysisOptions, paused = false) {
  const stockfish = useOneEngine(position, 'stockfish', options.stockfish, options.lines, 1500, options.revision, paused);
  const maia = useOneEngine(position, 'maia', options.maia, options.maiaLines, options.rating, options.revision, paused);
  return { stockfish, maia };
}
