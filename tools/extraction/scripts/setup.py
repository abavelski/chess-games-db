#!/usr/bin/env python3
"""Explicit online preparation. Imports never run this script implicitly."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PINS = json.loads((ROOT / 'pins.json').read_text())

def run(*args):
    command = list(map(str, args))
    if os.name == 'nt' and command[0] == 'mvn':
        command[0] = 'mvn.cmd'
    subprocess.run(command, cwd=ROOT, check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cbv', action='store_true', help='Also build pinned uncbv (requires Cargo once)')
    parser.add_argument('--offline', action='store_true', help='Compile against already installed Maven dependencies')
    args = parser.parse_args()
    for executable in ['java', 'mvn', 'git', 'node'] + (['cargo'] if args.cbv else []):
        if not shutil.which(executable):
            parser.error(f'Missing dependency: {executable}')
    run('java', '-version')
    if not args.offline:
        morphy = ROOT / '.deps/morphy'
        if not (morphy / '.git').exists():
            morphy.parent.mkdir(parents=True, exist_ok=True)
            run('git', 'clone', '--filter=blob:none', 'https://github.com/Yarin78/morphy.git', morphy)
        run('git', '-C', morphy, 'fetch', 'origin', PINS['morphy'])
        run('git', '-C', morphy, 'checkout', '--detach', PINS['morphy'])
        run('mvn', '-q', '-f', morphy / 'pom.xml', '-pl', 'morphy-cbh', '-am', 'install', '-DskipTests')
    run('mvn', *(['-o'] if args.offline else []), '-q', 'test', 'dependency:build-classpath',
        '-Dmdep.includeScope=runtime', '-Dmdep.outputFile=target/import-classpath.txt')
    if args.cbv:
        if args.offline:
            parser.error('CBV first build requires explicit online setup; omit --offline')
        run('cargo', 'install', '--git', 'https://github.com/antoyo/uncbv', '--rev', PINS['uncbv'],
            '--locked', '--root', ROOT / '.deps/uncbv')
    (ROOT / 'target/prepared.json').write_text(json.dumps(PINS, indent=2) + '\n')

if __name__ == '__main__':
    main()
