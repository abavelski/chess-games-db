// Follow score order, including variations; ply alone cannot identify a branch.
export function criticalNavigation(tokens, path) {
  const currentIndex = tokens.findIndex(token => token.type === 'move' && token.path === path);
  const positions = tokens.flatMap((token, index) => token.type === 'move' && token.critical?.length && typeof token.path === 'string'
    ? [{ path: token.path, index }] : []);
  return {
    total: positions.length,
    current: positions.findIndex(position => position.path === path) + 1,
    previous: positions.findLast(position => position.index < currentIndex)?.path ?? null,
    next: positions.find(position => position.index > currentIndex)?.path ?? null,
  };
}
