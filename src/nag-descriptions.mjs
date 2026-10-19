// PGN specification, section 10:
// https://github.com/vladmandic/chess/blob/main/docs/pgn-specs.md#10-numeric-annotation-glyphs
// Rook placement uses 94–97; the linked transcription misprints these as 84–87.
const descriptions = [
  'No annotation',
  'Good move',
  'Poor move',
  'Very good move',
  'Very poor move',
  'Speculative move',
  'Questionable move',
  'Forced move; other moves lose quickly',
  'Singular move; no reasonable alternative',
  'Worst move',
  'Drawish position',
  'Equal chances, quiet position',
  'Equal chances, active position',
  'Unclear position',
];
const pair = (start, text) => {
  descriptions[start] = `White ${text}`;
  descriptions[start + 1] = `Black ${text}`;
};
const advantages = (start, subject) => ['slight', 'moderate', 'decisive'].forEach((degree, index) => pair(start + index * 2, `has a ${degree} ${subject}advantage`));
advantages(14, '');
pair(20, 'has a crushing advantage; the opponent should resign');
pair(22, 'is in zugzwang');
advantages(24, 'space ');
advantages(30, 'development ');
pair(36, 'has the initiative');
pair(38, 'has a lasting initiative');
pair(40, 'has the attack');
pair(42, 'has insufficient compensation for a material deficit');
pair(44, 'has sufficient compensation for a material deficit');
pair(46, 'has more than enough compensation for a material deficit');
advantages(48, 'center control ');
advantages(54, 'kingside control ');
advantages(60, 'queenside control ');
pair(66, 'has a vulnerable back rank');
pair(68, 'has a well-protected back rank');
pair(70, 'has a poorly protected king');
pair(72, 'has a well-protected king');
pair(74, 'has a poorly placed king');
pair(76, 'has a well-placed king');
['very weak', 'moderately weak', 'moderately strong', 'very strong'].forEach((strength, index) => pair(78 + index * 2, `has a ${strength} pawn structure`));
['knight', 'bishop', 'rook', 'queen'].forEach((piece, index) => {
  pair(86 + index * 4, `has poor ${piece} placement`);
  pair(88 + index * 4, `has good ${piece} placement`);
});
pair(102, 'has poor piece coordination');
pair(104, 'has good piece coordination');
['opening', 'middlegame', 'ending'].forEach((phase, index) => {
  ['very poorly', 'poorly', 'well', 'very well'].forEach((quality, offset) => pair(106 + index * 8 + offset * 2, `has played the ${phase} ${quality}`));
});
['slight', 'moderate', 'decisive'].forEach((degree, index) => pair(130 + index * 2, `has ${degree} counterplay`));
pair(136, 'is under moderate time pressure');
pair(138, 'is under severe time pressure');

export const nagDescriptions = Object.freeze(descriptions);

// Non-standard conventions listed at:
// https://en.wikipedia.org/wiki/Portable_Game_Notation#Non-standard_NAGs
// An empty symbol preserves the numeric code when a custom chess font is needed.
export const nonStandardNagGlyphs = Object.freeze(Object.fromEntries([
  [140, '∆', 'With the idea…'],
  [141, '∇', 'Aimed against…'],
  [142, '⌓', 'Better is…'],
  [143, '<=', 'Worse is…'],
  [144, '==', 'Equivalent is…'],
  [145, 'RR', 'Editorial comment'],
  [146, 'N', 'Novelty'],
  [147, '!!!', 'Rare brilliant move; hard to find'],
  [148, '!??', 'Dubious but dangerous in practice; difficult to refute'],
  [220, '⬒', 'Diagram'],
  [221, '⬓', 'Diagram from Black’s perspective'],
  [238, '○', 'Space advantage'],
  [239, '⇔', 'File'],
  [240, '⇗', 'Diagonal'],
  [241, '⊞', 'Centre'],
  [242, '⟫', 'Kingside'],
  [243, '⟪', 'Queenside'],
  [244, '✕', 'Weak point'],
  [245, '⊥', 'Ending'],
  [246, '', 'Bishop pair'],
  [247, '', 'Opposite-coloured bishops'],
  [248, '', 'Same-coloured bishops'],
  [249, '⯺', 'Connected pawns'],
  [250, '⯻', 'Isolated pawns'],
  [251, '⯼', 'Doubled pawns'],
  [252, '⯽', 'Passed pawn'],
  [253, '', 'Pawn majority'],
  [254, '∟', 'With'],
  [255, '⯾', 'Without'],
].map(([nag, symbol, name]) => [nag, Object.freeze({ symbol, name })])));

export function nagDescription(nag) { return nagDescriptions[nag] ?? nonStandardNagGlyphs[nag]?.name; }
