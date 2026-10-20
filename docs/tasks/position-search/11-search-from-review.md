# PS-11 — Find matching games from any reviewed position

Status: **planned**. Depends on: PS-07, PS-10.

## Deliver

- Add **Find games with this position** to Game Review (original mainline, source variation or saved personal variation where the board position is legal). Use the current validated position from the viewer/analysis state, not a manually reconstructed move number or a UI board-only string.
- Switch to browser with an active position query and **preserve all existing filters**. Default query scope to mainline; allow the user to opt into source variations. The currently open game may appear naturally among matches; do not falsely deduplicate other annotated editions.
- Support return to the originating game at its original exact path, with scroll, focus, analysis state and unsaved-edit protections. Respect the existing Save/Discard/Cancel prompt if navigating away with personal notes.
- Disable with explanation for invalid free-piece mode positions, empty/unavailable archive or unsupported search position; don't pass an illegal board state into the index API.

## Acceptance / tests

- Launch from source sideline and independently saved legal personal branch; query finds a different annotated game with the same position.
- Return to the correct originating game, path and review state; no loss of unsaved comments or variation edits.
- Opening from Piece mode is unavailable or explicitly exits it without illegal search.
- Filter persistence, keyboard/back navigation, and no-index coverage are covered in desktop smoke; `npm test`, `npm run build`.
