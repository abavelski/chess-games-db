import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCatalogue, digest } from '../electron/openings.mjs';
import { enrichOpenings } from '../electron/opening-enrichment.mjs';

export async function readCatalogue(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('Manifest requires a pinned 40-character upstream commit');
  const files = {};
  for (const file of ['a', 'b', 'c', 'd', 'e']) {
    const bytes = await readFile(join(directory, file + '.tsv'));
    if (digest(bytes) !== manifest.files?.[file + '.tsv']) throw new Error(`Checksum mismatch: ${file}.tsv`);
    files[file] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  let overrides = {};
  if (manifest.overrides) {
    const bytes = await readFile(join(directory, 'overrides.json'));
    if (digest(bytes) !== manifest.overrides) throw new Error('Checksum mismatch: overrides.json');
    overrides = JSON.parse(bytes);
  }
  return { manifest, catalogue: buildCatalogue(files, overrides), checksum: digest(JSON.stringify([manifest.files, manifest.overrides ?? null])) };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    commit: { type: 'string' }, out: { type: 'string' }, input: { type: 'string' }, database: { type: 'string' },
    'dry-run': { type: 'boolean' }, rebuild: { type: 'boolean' }, 'max-games': { type: 'string' },
  } });
  if (positionals[0] === 'download') {
    if (!/^[a-f0-9]{40}$/.test(values.commit ?? '') || !values.out) throw new Error('Usage: npm run openings -- download --commit <40-character SHA> --out <new directory>');
    const target = resolve(values.out), staging = target + '.tmp-' + randomUUID();
    await mkdir(staging, { recursive: true });
    try {
      const manifest = { commit: values.commit, source: 'https://github.com/lichess-org/chess-openings', license: 'CC0-1.0', files: {} };
      for (const file of ['a', 'b', 'c', 'd', 'e']) {
        const response = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/${values.commit}/${file}.tsv`, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Download failed: ${file}.tsv HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        manifest.files[file + '.tsv'] = digest(bytes);
        await writeFile(join(staging, file + '.tsv'), bytes);
      }
      await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      const input = await readCatalogue(staging);
      await rename(staging, target);
      console.log(JSON.stringify({ directory: target, entries: input.catalogue.entries.length, ...manifest }, null, 2));
    } finally { await rm(staging, { recursive: true, force: true }); }
  } else if (positionals[0] === 'enrich') {
    if (!values.input || !values.database) throw new Error('Usage: npm run openings -- enrich --input <catalogue directory> --database <archive> [--dry-run] [--rebuild] [--max-games N]');
    const limit = values['max-games'] === undefined ? Infinity : Number(values['max-games']);
    if (!(limit > 0) || (limit !== Infinity && !Number.isSafeInteger(limit))) throw new Error('--max-games must be a positive integer');
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
    const result = await enrichOpenings(values.database, await readCatalogue(values.input), {
      dryRun: values['dry-run'], rebuild: values.rebuild, maxGames: limit, signal: controller.signal,
      progress: value => console.error(`Classified ${value.processed} games (${value.total} total)`),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!values['dry-run'] && !result.published) process.exitCode = 2;
  } else throw new Error('Commands: download, enrich. See README.md for the offline enrichment workflow.');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
