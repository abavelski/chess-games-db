# Piece mode and Maia play

The shared `PieceMode` component is used by game review, opening model-game
review and article study. Changes apply to every entry point.

Piece mode opens at the current review position and orientation. **Free mode**
lets you move either color without chess rules. Right-drag to draw arrows and
right-click to mark squares; Shift/Ctrl and Alt change the drawing color.
**Clear drawings** removes marks without changing the pieces.

**Continue with Maia** starts a legal game from the current arrangement. Choose
**Play as**, **Side to move** and **Maia strength** (600–2600). Strength is saved
locally and can also be changed during a game. Maia uses the existing local
engine configuration and samples from its legal candidate moves by probability.
Invalid setups remain in free mode with an explanation; the app never repairs
missing kings or illegal pawn placement silently.

Legal play enforces turns, checks, castling, en passant and promotion. Checkmate,
stalemate, insufficient material, fivefold repetition and the 75-move rule end
play. Threefold repetition and the 50-move rule expose **Claim draw** on your
turn. Edited setups clear en passant and prior draw history; free movement of a
king or rook removes its castling rights even if it is moved back.

**Free mode** keeps the current arrangement and lets you edit again. Returning
to legal play without editing preserves the current castling/en-passant metadata
and move counters, while beginning a new repetition history.
**Reset position** stops Maia, clears drawings and restores the exact position
at which Piece mode was opened, in free mode. **Return to review** or Escape
restores the original review position, scroll and focus. Sandbox games never
modify source games, article positions or saved personal analysis.

Maia requests are cancelled on reset, free mode, strength changes and closing.
Late replies cannot play on the replacement board. Engine failures show a retry
action while leaving reset/free/return available. The board stays mounted across
mode switches; drawing is available during legal play, including Maia's turn.

Verification:

```powershell
node --test tests/piece-game.test.mjs
npm.cmd run build
node scripts/start-electron.mjs tests/piece-mode-desktop-smoke.mjs
```

The desktop test uses a synthetic legal UCI fixture through the real engine IPC;
it does not require the Maia model checkpoint. Model quality is not measured.
