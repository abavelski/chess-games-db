# Chapter PGN interoperability

Automated status: offline semantic round trips are tested. Real Lichess round trip: **NOT VERIFIED — RELEASE BLOCKER**. No authenticated Lichess session is available to this implementation run. Completing the fixture matrix does not clear that blocker.

| Data | Offline coverage | Remote status |
| --- | --- | --- |
| Standard mainline, nested branches, same-SAN siblings | Semantic ordered-tree equality, repeated export/import | Not verified |
| Empty/unfinished games and standard-root promotion | Fixtures | Not verified |
| Root/move comments, Unicode, NAGs 1–6 and numeric glyphs | Fixtures and editing tests | Not verified |
| G/R/B/Y arrows and square highlights | Root and separate branches | Not verified |
| Unknown headers and directives (including evaluation/clock) | Preserved locally | Remote may normalize or remove them; not verified |
| Literal braces inside prose | Readable parentheses plus lossless `[%cbtext]` UTF-8 backup locally | Exact text requires remote retention of custom directive; not verified |
| Local title, kind, free-form tags, source URL | Intentionally local collection metadata | Not transported |
| Chapter order, study members/privacy, gamebook/lesson behavior | Outside PGN contract | Not transported |

## Manual release procedure

1. Use a disposable standard-chess Lichess chapter. Include a long mainline, two nested variation levels, duplicate siblings if supported, a root note, Unicode prose, NAGs, promotion and all four drawing colors. Export **Chapter PGN** with comments and variations.
2. In My Studies select **Import chapter PGN**, paste or choose the UTF-8 file, and import as a new study. Check the mainline, every branch, root and position annotations visually.
3. Make one move/prose/drawing edit and Save. Select **Saved study** under PGN export version; Copy or Export chapter PGN.
4. In Lichess add a new chapter using its PGN import option. Check supported content, then export that chapter again. Import into My Studies as another new study.
5. Compare normalized move tree, comments, NAGs and drawings using the offline helpers; record differences, Lichess test date, app commit and tested annotation subset below. Never put account tokens in this repository.
6. Verify a draft export is explicitly selected and does not modify the saved study. Confirm local collection labels do not appear as invented PGN headers.

Release record: pending. This feature provides portable chapter PGN, with **no cloud synchronization** or full Lichess study backup claim.
