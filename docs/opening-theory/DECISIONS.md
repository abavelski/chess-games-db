# Opening study decisions and review

## OT-01 · 2026-10-25

The user selected one repository/build with separate Games and Openings
workspaces. Each keeps its own selected file and session. The runtime opening
library is a new format opened read-only; neither source v1 nor Games v7 is
migrated. Mutable preferences and resume state have a separate store.

MVP filters: source role (Main collection / Theory), direct article membership,
metadata (title/ECO/player/annotator), and annotation language. Dimensions use
AND; values within a dimension use OR. Reading language changes presentation.
Source-role filters are sufficient for initial copy handling: no deduplication
by unvalidated header identity. Copies remain separate records and lines.

The terminology is internally consistent with the counting contract. **Game
records** includes copies; **Source lines** means available root-to-leaf source
paths, never training progress; **Related articles** means direct association,
not a claim about the exact position. Player comprehension remains to be
observed at OT-13; no user usability approval is claimed here.

### Static workspace sketch

Study opening: Sicilian Defence, confirmed by the player on 2026-10-25.

```text
Games | OPENINGS                       Library…  Coverage…
Board                   Continuations          Study material
1.e4 c5                 2.Nf3 [counts]          Articles | Games | Comments
                        2.Nc3 [counts]          [Title] Linked example
Undo  Reset             Ending lines: …         [Title] Same chapter
Find other move orders                         Study this article
Move order · e4 c5       Main / Theory          Reading language: English
```

Playing a legal move follows only actual children of the retained source nodes.
An unsupported move leaves a legal board with Undo and no indexed continuation.
Find other move orders explicitly creates a position anchor and preserves the
previous route for return. Example review and article reading preserve the
explorer's board, filters, page, focus and scroll.

### Worked counter examples

Use A with `e4 c5 Nf3` and `e4 c5 Nc3`; B with `e4 e5 Nf3`; C ending at `e4`;
and A′ as another edition of A. Article X links A and A′, article Y links B.

| Prefix | Game records | Source lines | Related articles | Ending lines |
| --- | ---: | ---: | ---: | ---: |
| root | 4 | 6 | 2 | 0 |
| e4 | 4 | 6 | 2 | 1 |
| e4 c5 | 2 | 4 | 1 | 0 |
| e4 c5 Nf3 | 2 | 2 | 1 | 2 |

One game/article can appear under both Nf3 and Nc3; sibling record/article
counts are not additive. Identical sibling branches retain different leaves.

For transpositions, D is `Nf3 d5 g3`, E is `g3 d5 Nf3`. Following D's move
order finds D only. An explicit position search at the common final position
finds both. Subsequent moves advance only their actual source children.

For repetition, F is `Nf3 Nf6 Ng1 Ng8 e4`, with a sibling `d4` after the
second root position. A standard-position anchor has cursors at F's root and
after Ng8. Its union contains two leaves, not four. The child Nf3 can support
both leaves while child e4 supports one and d4 the other: anchor child line
counts need not partition the parent's lines. Node cursors remain separate even
when their descendant leaf intervals overlap.

Deferred: opening engines, training, learned-state counters, repertoire editing,
notes, cloud, online statistics, AI prose, full-text annotation search, historical
game deduplication and a second installer. Existing Games features stay in scope
for regression verification, not redesign.
