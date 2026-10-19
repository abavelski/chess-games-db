# Annotation glyphs

Hover over an annotation symbol in the review score to read its meaning.
In **Game review settings**, turn on **Show glyph descriptions** to also display
the text in parentheses beside each symbol, such as `! (Good move)`. The setting
is off by default and persists across games. It does not move the board or reveal
annotations hidden by Study stops. Numeric engine evaluations keep their existing
presentation.

Descriptions cover NAGs `$0`–`$139` from the
[PGN specification, section 10](https://github.com/vladmandic/chess/blob/main/docs/pgn-specs.md#10-numeric-annotation-glyphs).
The table accidentally repeats 84–87 for rook placement between 93 and 98; the
implementation assigns those four entries to 94–97 and preserves the pawn and
knight descriptions at 84–87.

Non-standard conventions follow the
[non-standard NAG table](https://en.wikipedia.org/wiki/Portable_Game_Notation#Non-standard_NAGs):
`$140`–`$148`, `$220`–`$221`, and `$238`–`$255`. For example, ChessBase exports
using `$142` display `⌓ (Better is…)` when descriptions are enabled. These
conventions are extensions, not definitions in the PGN specification.
Diagram symbols are displayed as annotations; they do not insert a board diagram.
Entries requiring a custom chess font (`$246`–`$248`) or text (`$253`) retain
their numeric codes with meaningful descriptions. Undefined codes remain visible
as `$number` with an explicit fallback description. Where no symbol is supplied
by the viewer or extension mapping, the numeric code is preserved.
