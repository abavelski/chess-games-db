# OT-02 source quality inventory

Run from the repository root (Python standard library only):

```powershell
python scripts/opening-source-inventory.py --source data/tmp/opening-theory.sqlite --output data/opening-study/source-inventory-v2.json
python tests/opening-source-inventory.test.py
```

The tool refuses existing reports, non-source formats and a nonempty WAL. It
opens immutable/read-only, enables query-only, checks integrity and foreign
keys, and compares a full source SHA-256 before/after. Reports contain source
locators and must stay under ignored `data/`. The local JSON is the real-data
fixture manifest: snapshot hash, every diagnostic/error locator, root inventory,
per-language body classifications and deterministic samples across source eras.
No source text is required by committed tests.

## Observed snapshot · 2026-10-25

| Item | Actual | Reconciliation |
| --- | ---: | --- |
| Databases | 1,465 | Matches extraction summary |
| Game occurrences | 81,404 | Matches extraction summary |
| Articles | 1,484 | Matches extraction summary |
| Source items | 82,888 | Games + articles |
| Annotations | 1,860,129 | Matches extraction summary |
| Language bodies | 11,872 | Eight native language rows per article |
| Anchors | 5,170,726 | Matches extraction summary |
| Decoder errors | 3 | All listed in local manifest |
| Diagnostic records | 4,558 | All listed, not presumed invalid chess |
| Explicit game relations | 12,500 | Matches extraction summary |
| Same-source relations | 42,675 | Matches extraction summary |

SQLite integrity: `ok`; foreign-key violations: zero. Source file: 4,788,133,888
bytes. The pre/post full-file hashes agree. The source is still unvalidated for
legal chess. Reported move totals are decoder measurements, not accepted nodes.

Mandatory error fixtures (native IDs, not runtime or archival row IDs): main
record 11022, unknown annotation type 0x20; Theory D15_2009 09_Slav Defence.cbh
record 4 and D50_2003 01_Queens Gambit Canal Gambit.cbh record 26, move decode
errors. Preserve them unchanged. No repair from the separate cleaned export is
authorized by this implementation plan.

## Article sampling and limits

Inspected the older A00_2001 and A17_2000 and newer A07_2023 layouts. Both eras
have large shared navigation wrappers (`navbar`, `SideBar`) preceding actual
article prose. Older content includes legacy key-bitmap links; newer content
uses local image references and FEN metadata. Sampled FEN alt fields may end in
a semicolon. Original encoding damage occurs in link arguments even when the
visible label is intact. Neither labels nor raw numeric hints establish targets.

The body inventory excludes recognized navigation and active/head content,
then reports non-link prose candidates, short/navigation bodies and empties.
This is an inventory heuristic, not a security sanitizer or verified translation
availability. OT-06 must retain a safe whole-body fallback when extraction is
uncertain. The manifest keeps source-language identifiers and samples from
multiple decades. The old two-Theory `content-audit` findings are historical;
current counts come from the complete SQLite snapshot.

The refined full pass reports 2,958 prose candidates and 8,914 bodies with no
remaining visible text. The first pass (without recognized navigation removal)
reported 2,959 and 8,913 respectively: one nonempty body was navigation only.
These are heuristic body dispositions, not promises of complete translations.
The final pass took 116 seconds including two full source hashes and integrity
checks. All extraction-summary totals and relationship-resolution buckets match.

## Redistributable fixtures

[opening-study.mjs](../../tests/fixtures/opening-study.mjs) contains original
synthetic trees with explicit leaf paths and source-index/branch-path oracles.
Coverage includes nested variations, duplicate same-move siblings, setup FEN
with nondefault counters, repetition, transposition, terminal prefixes, null
moves, illegal branches, unknown/trailing tokens, unclosed branches and missing
roots. Annotation samples include root/before/after/multiple same-language
comments, language alternatives, NAGs, arrows, squares, evaluation arrays and
an unknown type. Arrays are preserved as unsupported until independently verified.

Article fixtures include navigation-only language content with meaningful
fallback, resolved/ambiguous/unavailable links and untrusted hints, malformed
HTML, scripts/handlers/CSS/network/file/data URLs, encoding damage, valid/invalid
FEN diagram metadata, missing media and a standalone essay. OT-03–OT-08 add
behavioral assertions as their readers/builders are introduced.
