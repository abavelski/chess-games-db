// Original synthetic material. No encyclopedia text or game payloads.
export const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const annotation = (sequence, move_index, annotation_type, payload, language = null) => ({
  sequence, move_index, annotation_type, language,
  text: payload.text ?? null, payload_json: JSON.stringify({ _type: annotation_type, move: move_index, ...payload }),
});
export const treeFixtures = [
  { key: 'nested', moves_pgn: '1. e4 c5 (1... c6 2. d4 (2. Nf3 d5)) 2. Nf3 *',
    start_fen: standardFen, all_lines_ply: 7,
    expected: [
      { san: 'e4', path: '0', sourceIndex: 0 },
      { san: 'c5', path: '0.0', sourceIndex: 1 },
      { san: 'c6', path: '0.1', sourceIndex: 2 },
      { san: 'd4', path: '0.1.0', sourceIndex: 3 },
      { san: 'Nf3', path: '0.1.1', sourceIndex: 4 },
      { san: 'd5', path: '0.1.1.0', sourceIndex: 5 },
      { san: 'Nf3', path: '0.0.0', sourceIndex: 6 },
    ],
    // Explicit leaf oracle, deliberately independent of interval arithmetic.
    leaves: [['e2e4', 'c7c5', 'g1f3'], ['e2e4', 'c7c6', 'd2d4'], ['e2e4', 'c7c6', 'g1f3', 'd7d5']],
    annotations: [
      annotation(0, -1, 'TextBefore', { text: 'Synthetic root explanation.' }, 'ENG'),
      annotation(1, 2, 'TextBefore', { text: 'Prepare a different pawn structure.' }, 'ENG'),
      annotation(2, 2, 'TextAfter', { text: 'The c-pawn supports d5.' }, 'ENG'),
      annotation(3, 2, 'TextAfter', { text: 'Der c-Bauer unterstützt d5.' }, 'GER'),
      annotation(4, 3, 'Symbols', { nags: [1, 14] }),
      annotation(5, 3, 'Arrows', { arrows: [{ _type: 'ColoredArrow', from: 'd2', to: 'd4', color: 'green' }] }),
      annotation(6, 3, 'Squares', { squares: [{ _type: 'ColoredSquare', square: 'd4', color: 'red' }] }),
      annotation(7, -1, 'Evaluations', { evaluations: [{ eval: 23, depth: 0, evalType: 0 }, { eval: -5, depth: 4, evalType: 1 }] }),
      annotation(8, 4, 'FutureType', { opaque: [1, 'retain exactly'] }),
      annotation(9, 2, 'TextAfter', { text: 'A second comment in the same language.' }, 'ENG'),
    ] },
  { key: 'duplicate-siblings', start_fen: standardFen,
    moves_pgn: '1. e4 e5 (1... e5 2. Nc3) 2. Nf3', all_lines_ply: 5,
    leaves: [['e2e4', 'e7e5', 'g1f3'], ['e2e4', 'e7e5', 'b1c3']] },
  { key: 'setup-counters', start_fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 17 42',
    moves_pgn: '42... Kf7 43. e4', all_lines_ply: 2,
    leaves: [['e8f7', 'e2e4']] },
  { key: 'repeated-root', start_fen: standardFen,
    moves_pgn: '1. Nf3 Nf6 2. Ng1 Ng8 3. e4 (3. d4)', all_lines_ply: 6,
    leaves: [['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4'], ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'd2d4']] },
  { key: 'transposition-a', start_fen: standardFen, moves_pgn: '1. Nf3 d5 2. g3', all_lines_ply: 3 },
  { key: 'transposition-b', start_fen: standardFen, moves_pgn: '1. g3 d5 2. Nf3', all_lines_ply: 3 },
  { key: 'ends-at-prefix', start_fen: standardFen, moves_pgn: '1. e4', all_lines_ply: 1 },
  { key: 'null-branch', start_fen: standardFen, moves_pgn: '1. e4 e5 (1... -- 2. d4)', invalid: true },
  { key: 'illegal-branch', start_fen: standardFen, moves_pgn: '1. e4 e5 (1... Ke7)', invalid: true },
  { key: 'damaged-token', start_fen: standardFen, moves_pgn: '1. e4 garbage e5', invalid: true },
  { key: 'unclosed-branch', start_fen: standardFen, moves_pgn: '1. e4 e5 (1... c5', invalid: true },
  { key: 'trailing-token', start_fen: standardFen, moves_pgn: '1. e4 * e5', invalid: true },
  { key: 'missing-fen', start_fen: null, moves_pgn: '1. e4', invalid: true },
];

export const articleFixtures = [
  { key: 'language-fallback', versions: [
    { language: 'ENGLISH', html: '<nav><a href="javascript:CBLink(1)">Home</a><a href="https://example.invalid">Index</a></nav>', meaningful: false },
    { language: 'GERMAN', html: '<h1>Ein Plan</h1><p>Original synthetic prose explaining the central pawn advance and the development of the knights. Keep the king safe before starting a flank attack.</p>', meaningful: true },
  ] },
  { key: 'controlled-links', html: '<h2>A useful example</h2><p>Original teaching text. <a href="javascript:CBLink(7,19)">Example</a> <a href="javascript:CBLink(8)">Candidates</a> <a href="javascript:CBLink(9)">Unavailable</a></p>',
    targets: [{ ordinal: 0, status: 'resolved_game', target: 'nested', rawPositionHint: '19', validatedNode: null },
      { ordinal: 1, status: 'ambiguous', candidates: ['transposition-a', 'transposition-b'] },
      { ordinal: 2, status: 'outside_extracted_scope' }] },
  { key: 'unsafe-malformed', html: '<style>p{background:url(https://example.invalid)}</style><script>alert(1)</script><p onclick="alert(2)">Safe words<b> retained<a href="java&#x73;cript:alert(3)">label</a><img src="file:///secret" onerror="alert(4)"><iframe src="https://example.invalid"></iframe><svg onload="alert(5)"><a href="data:text/html,attack">More words' },
  { key: 'diagram-and-missing-media', html: `<p>Read the position.</p><img src="https://example.invalid/board.png" alt="fen:${standardFen}"><img src="missing.mp4" alt="Unavailable video"><img alt="fen:broken">` },
  { key: 'encoding-damage', html: '<h1>King\uFFFDs plan</h1><p>Keep the original damaged label; never guess a record from its visible title.</p>' },
  { key: 'standalone', html: '<h1>Independent essay</h1><p>An essay without playable examples remains available in the article title catalogue.</p>', targets: [] },
];
