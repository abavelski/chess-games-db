# Extraction support provenance

The Java annotation converter/language selector, PGN metadata helpers and Python
CBV/recovery helpers were consolidated from the author's local `cb` experiments
on 2026-10-21. Original package names and annotation encodings are retained. The
sibling project has no Git metadata or separate license file. These app-owned
adapters are distributed under this repository's GPL-3.0-or-later license.
Experimental exporters and legacy SQLite writers are deliberately excluded.

`pins.json` records the existing dependency revisions. Morphy is fetched from
https://github.com/Yarin78/morphy at the pinned revision; that checkout contains
no top-level license file. It is downloaded only by explicit setup and is not
vendored or redistributed here. uncbv is built from
https://github.com/antoyo/uncbv at the pinned revision (GPL-3.0; its source and
license remain in Cargo's checkout). Other dependency notices/licenses remain
in their Maven artifacts: SQLite JDBC (Apache-2.0/BSD), zstd-jni (BSD-2-Clause),
SLF4J (MIT), Jackson (Apache-2.0). Do not remove those notices when packaging.

Annotation output changes from the former MegaBase path: the unified adapter
retains FEN starts, unknown players, null moves and source-deleted games and
reports filter/exclusion reasons. It still uses ArchivePgnAnnotations and
AnnotationLanguages, preserving the original full-fidelity annotation conversion.
