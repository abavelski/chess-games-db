# Personal Studies implementation contract

One local study is one standard-root game tree and corresponds to one Lichess chapter. Blank and unfinished scores are valid. Imported identical SAN siblings retain separate identity. PGN owns all headers, root/move comments, NAGs, ordered variations and directives; title, kind, tags and provenance are local metadata. Unknown headers and directives survive editing.

Limits: UTF-8 PGN 2 MiB; 10,000 moves; 1,024 plies per path; 64 nested variations; 200 visible title characters; 64 tags of 64 characters; header values 1,000 characters; comments 32,000 characters; list pages 1–100. Tags compare by trimmed, whitespace-collapsed lowercase keys; tag filtering uses AND. Search is a literal substring across title, White, Black and Event. Default ordering is updated time descending, then ID ascending. Years derive only from valid PGN dates.

Only the dedicated app userData/personal-studies.sqlite3 may be written. No archive or opening schema migration, selected file change, personal game overlay write, network call or engine download belongs to studies. Tests use disposable profiles and fixture databases exclusively.

An unchanged imported PGN stays byte-identical until an explicit edit/save. Saves validate every branch and update the PGN, indexed metadata and tags atomically using expectedRevision. Failure or conflict retains the draft. All leave paths require Save/Discard/Cancel for dirty drafts.

The fixture cases declare rejection requirements; annotated.pgn covers root annotations, 26 mainline plies, nested and duplicate siblings, ratings, six NAGs, all four drawing colors, Unicode, unknown headers and directives. Codec tests added in PS-07 enforce these cases.
