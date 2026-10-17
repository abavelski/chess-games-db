# Critical positions and medals

- PGN tags `[%crit opening]`, `[%crit middlegame]`, and `[%crit endgame]` become blue, red, and green diamonds beside the annotated move, with phase tooltips.
- Medal tags such as `[%medal tactics,attack,sacrifice]` become a gold medal icon beside the move, with all category names written beside it (for example, “tactics, attack, sacrifice”) and in its tooltip. Labels are case-insensitive and deduplicated per move; each distinct label counts as one medal. A move with multiple medals or both kinds of marker creates one study stop.
- Previous/next buttons visit critical positions and medals in score order, including variations, and stop at either end. Illegal moves are excluded from navigation and indexing. Multiple phase tags on one move count as one position; unknown tags remain readable.
- Games with indexed markers show separate critical-position and medal counts in the game browser. Use **Study markers → Yes** to select them, or **No** to select indexed games with none.
- In **Game review settings**, enable **Study stops** (eye icon, beside **Flip board**). The setting persists across games. The board stays at the selected position, and the score stops at the next reachable critical position or medal after it. Toggling the setting preserves the current board position and temporary exploration; disabling it shows the complete score. If no marker remains ahead, the score stays fully visible. Following commentary, moves, result, and PGN information stay hidden. The stopping move’s evaluation and glyphs are hidden until you reveal the next section.
- Study freely by playing temporary moves on the board or opening **Piece mode**. The small **eye button beside the critical-position diamond or medal icon** reveals the score through the next critical position or medal (including variations); after the last marker it reveals the rest of the game. Hover over it for an explanation. Revealing leaves the current board position and any temporary exploration unchanged; use the normal arrows or select a move to navigate. Move buttons, keyboard shortcuts, and marker navigation cannot cross the reveal boundary. Disable the setting to show the full game. Games without reachable markers display normally.
- The original PGN and source archive content remain unchanged. Markers are study bookmarks, not graded exercises.

## Index an archive once

The desktop opens v7 read-only. Convert legacy v3–v6 files using the [explicit migration](../README.md#schema-version), then run on the new games file:

```sh
npm run study-markers -- --database data/annotated-games.sqlite3
```

The converter and shared writer derive features automatically. Maintenance retries pending/error/stale games; `--rebuild` recomputes all. Counts live in `game_features`, keyed by game ID, PGN hash and extractor version. Pending or failed extraction is unknown, distinct from zero; select explicit **Unknown** in a marker dropdown. The combined **Yes** option means critical positions or medals; **No** requires successful extraction with both zero.

The script checks compression/SHA-256 and parses unchanged PGNs, including variations. Invalid setups or unreachable moves preserve the game with an error/unknown feature state. Corrupt bytes/checksums roll back the whole run. Cache and content revisions update transactionally. No original PGN, header, hash or source metadata is rewritten. The older `npm run critical-positions` command remains an alias. Historical v5/v6 count columns are legacy inputs only.
