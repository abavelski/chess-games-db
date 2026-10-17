const isStudyStop = token => token.type === 'move' && (token.critical?.length || token.medals?.length) && typeof token.path === 'string';

// Follow score order, including variations; ply alone cannot identify a branch.
export function criticalNavigation(tokens, path) {
  const currentIndex = tokens.findIndex(token => token.type === 'move' && token.path === path);
  const positions = tokens.flatMap((token, index) => isStudyStop(token)
    ? [{ path: token.path, index }] : []);
  return {
    total: positions.length,
    current: positions.findIndex(position => position.path === path) + 1,
    previous: positions.findLast(position => position.index < currentIndex)?.path ?? null,
    next: positions.find(position => position.index > currentIndex)?.path ?? null,
  };
}

// Reveal a prefix of score order, so variations use the same stops as navigation.
export function criticalReveal(tokens, stage = 0, enabled = true) {
  const stops = tokens.flatMap((token, index) => isStudyStop(token)
    ? [{ path: token.path, index }] : []);
  const stop = enabled ? stops[stage] : null;
  const visible = stop ? tokens.slice(0, stop.index + 1).map((token, index) => index === stop.index
    ? { ...token, evaluations: [], nags: [] } : token) : tokens;
  return {
    tokens: visible,
    paused: !!stop,
    path: stop?.path ?? tokens.findLast(token => token.type === 'move' && !token.depth && typeof token.path === 'string')?.path ?? '',
    allowedPaths: new Set(['', ...visible.filter(token => token.type === 'move' && typeof token.path === 'string').map(token => token.path)]),
  };
}

// Enabling study starts at the next marker after the selected score position.
export function criticalRevealStage(tokens, path) {
  const currentIndex = tokens.findIndex(token => token.type === 'move' && token.path === path);
  return tokens.reduce((count, token, index) => count + (index <= currentIndex && isStudyStop(token) ? 1 : 0), 0);
}
