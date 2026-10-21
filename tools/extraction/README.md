# Local extraction tools

Plain UTF-8 PGN import needs only Node 22+ and installed app npm dependencies.
SQLite commands run through `scripts/run-archive-tool.mjs` using Electron's ABI.
ChessBase additionally needs JDK 21+, Maven, Git and Python 3. First CBV setup
also needs Rust/Cargo. Dependencies are never fetched during import.

Explicit online setup (from the repository root):

```sh
npm install
python3 tools/extraction/scripts/setup.py --cbv
```

Omit `--cbv` for CBH only. `--offline` recompiles/tests using installed Maven
artifacts and performs no downloads. A clean checkout needs the online setup
once. Preparation stamps the pinned dependencies and Java source checksum; stale builds
are refused before import. Re-run setup after changing extraction code.
Preserve `target/` and your Maven cache for offline import. No sibling `cb`
checkout is used. Tests: `mvn -f tools/extraction/pom.xml test` and
`python3 -m unittest discover -s tools/extraction/scripts/tests`.

On macOS use a JDK 21+ and Maven on PATH. On Windows run `python` instead of
`python3`, use a JDK 21+ and Maven (`mvn.cmd`) on PATH and invoke the npm command
from PowerShell. Java classpaths use the platform separator (`:` or `;`), never a
hard-coded separator. Quote paths with spaces/Unicode in both shells. User paths
are relative to the invocation directory; tool resources are module-relative.
