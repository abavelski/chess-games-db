const medals: Record<string, { name: string; description: string }> = {
  best: { name: 'Best Game', description: 'An exceptionally well-played or beautiful game.' },
  decided: { name: 'Decided Tournament', description: 'A game that determined a tournament result or winner.' },
  model: { name: 'Model Game', description: 'An instructive example of an opening or typical plan.' },
  novelty: { name: 'Novelty', description: 'An important new move or idea in opening theory.' },
  pawn: { name: 'Pawn Structure', description: 'Illustrates an important pawn formation or how to play it.' },
  strategy: { name: 'Strategy', description: 'Demonstrates important long-term positional ideas.' },
  tactics: { name: 'Tactics', description: 'Contains an instructive tactical combination or sequence.' },
  attack: { name: 'With Attack', description: 'Demonstrates an important attacking plan.' },
  sacrifice: { name: 'Sacrifice', description: 'Features a noteworthy material sacrifice.' },
  defense: { name: 'Defense', description: 'Shows instructive defensive technique.' },
  material: { name: 'Material', description: 'Illustrates important material imbalances or exchanges.' },
  piece: { name: 'Piece Play', description: 'Demonstrates effective piece placement, coordination, or maneuvering.' },
  endgame: { name: 'Endgame', description: 'Contains an instructive endgame.' },
  tactblunder: { name: 'Tactical Blunder', description: 'Highlights a concrete tactical mistake.' },
  stratblunder: { name: 'Strategical Blunder', description: 'Highlights a serious positional or strategic mistake.' },
  user: { name: 'User', description: 'A custom marker or bookmark added by the user.' },
};

export function medalName(code: string): string {
  return Object.hasOwn(medals, code.toLowerCase()) ? medals[code.toLowerCase()].name : code;
}

export function medalDescription(code: string): string {
  const medal = Object.hasOwn(medals, code.toLowerCase()) ? medals[code.toLowerCase()] : undefined;
  return medal ? `${medal.name}: ${medal.description}` : code;
}
