// Preserve source order while turning flat review tokens into variation groups
// and numbered mainline rows. Comments/variations interrupt a White/Black row.
export function reviewLayout(tokens) {
  const root = [];
  const stack = [root];
  for (const [index, token] of tokens.entries()) {
    const items = stack.at(-1);
    if (token.type === 'variation-start') {
      const variation = { type: 'variation', index, depth: token.depth, items: [], end: null };
      items.push(variation); stack.push(variation.items);
    } else if (token.type === 'variation-end' && stack.length > 1) {
      stack.pop(); stack.at(-1).at(-1).end = index;
    } else items.push({ type: 'token', token, index });
  }
  const rows = [];
  for (const item of root) {
    if (item.type !== 'token' || item.token.type !== 'move') { rows.push(item); continue; }
    const ply = item.token.ply || 1;
    const previous = rows.at(-1);
    const white = previous?.type === 'row' ? previous.white?.token : null;
    if (ply % 2 === 0 && white && !previous.black && white.ply === ply - 1 &&
        (white.path === null || item.token.path?.slice(0, -2) === white.path)) previous.black = item;
    else rows.push({ type: 'row', index: item.index, number: Math.ceil(ply / 2), white: ply % 2 ? item : null, black: ply % 2 ? null : item });
  }
  return rows;
}
