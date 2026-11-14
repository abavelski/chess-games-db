import { PlayError } from './kindle-play-game.mjs';

// All writes use the application-owned studies service, before publishing a turn.
export function createKindleStudyPersistence(store) {
  let current = null;
  return state => {
    const result = state.result ? { white_win: '1-0', black_win: '0-1', draw: '1/2-1/2' }[state.result.outcome] : '*';
    const humanWhite = state.playerColor === 'white';
    const headers = {
      Event: 'Kindle vs Maia', Date: state.startedAt.slice(0, 10).replaceAll('-', '.'),
      White: humanWhite ? 'Human' : 'Maia', Black: humanWhite ? 'Maia' : 'Human',
      [humanWhite ? 'BlackElo' : 'WhiteElo']: String(state.rating), Result: result,
      KindleGameId: state.gameId, Source: 'Kindle Play',
    };
    const moves = state.sanMoves.map((san, i) => `${i % 2 ? '' : `${i / 2 + 1}. `}${san}`).join(' ');
    const draft = {
      title: `Kindle ${state.startedAt} · Maia ${state.rating} · Human ${state.playerColor}`,
      kind: 'other', origin_kind: 'kindle-play', tags: ['Kindle Play', state.result ? 'Finished' : 'In progress'],
      pgn: Object.entries(headers).map(([key, value]) => `[${key} "${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`).join('\n') + `\n\n${moves} ${result}`,
    };
    try {
      const saved = current?.gameId === state.gameId
        ? store.update(current.id, draft, current.revision) : store.create(draft);
      current = { gameId: state.gameId, id: saved.id, revision: saved.revision };
    } catch (error) {
      const conflict = /revision conflict|missing study|not found/i.test(error.message);
      throw new PlayError(conflict ? 409 : 503, conflict ? 'STUDY_CONFLICT' : 'STORAGE_UNAVAILABLE',
        conflict ? 'Saved game was edited or deleted. Preserve your edits and start a new game after restarting the desktop app.' : 'Could not save game. Check disk space and personal studies storage, then retry.');
    }
  };
}
