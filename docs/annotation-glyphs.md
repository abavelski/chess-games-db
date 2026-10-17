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
knight descriptions at 84–87. Viewer extensions such as novelty keep their
existing descriptions. Undefined codes remain visible as `$number` with an
explicit fallback description. Where no symbol is supplied by the viewer, the
numeric code is preserved.
