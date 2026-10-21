import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
export const mandatory = ['.cbh','.cbg','.cba','.cbp','.cbt','.cbc','.cbs'];
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileHash(path) {
 const digest = createHash('sha256');
 for await (const chunk of createReadStream(path)) digest.update(chunk);
 return digest.digest('hex');
}
export async function revision(path) {
 const extension = extname(path).toLowerCase();
 const stem = basename(path, extname(path));
 const files = extension === '.cbh' ? readdirSync(dirname(path)).filter(name => basename(name, extname(name)) === stem && !['.cbv','.zip','.rar'].includes(extname(name).toLowerCase())).map(name => join(dirname(path),name)).filter(p => statSync(p).isFile()) : [path];
 const evidence = [];
 for (const file of files.sort()) evidence.push({ suffix: extension === '.cbh' ? extname(file).toLowerCase() : extension, size: statSync(file).size, sha256: await fileHash(file) });
 evidence.sort((a,b) => a.suffix.localeCompare(b.suffix));
 return { sha256: hash(JSON.stringify(evidence)), files: evidence };
}
export function discover({ input, booksRoot, book }) {
 if (!!input === !!booksRoot) throw new Error('Specify exactly one of --input or --books-root');
 const root = resolve(input ?? booksRoot), entries = [];
 function walk(path) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
   for (const item of readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory() || ['.cbh','.cbv','.pgn','.cbz','.zip','.rar','.cbf','.cb2'].includes(extname(item.name).toLowerCase())) walk(join(path,item.name));
   }
   return;
  }
  const format = extname(path).toLowerCase(), locator = input ? basename(path) : relative(root,path).split('\\').join('/');
  if (book && !locator.split('/').slice(0,-1).includes(book)) return;
  const entry = { path, locator, format, title: input ? basename(path, extname(path)) : locator.split('/')[0], status: 'candidate' };
  if (!['.cbh','.cbv','.pgn'].includes(format)) Object.assign(entry, { status: 'unsupported', reason: 'unsupported-format' });
  if (format === '.cbh') {
   const stem = basename(path,extname(path)), siblings = readdirSync(dirname(path)).filter(n => basename(n,extname(n)) === stem).map(n => extname(n).toLowerCase());
   const missing = mandatory.filter(e => !siblings.includes(e));
   if (missing.length) Object.assign(entry, { status:'unsupported', reason:'missing-sidecars', missing });
  }
  entries.push(entry);
 }
 walk(root);
 for (const entry of entries.filter(e => e.format === '.cbv' && e.status === 'candidate')) {
  const equivalents = entries.filter(e => e.format === '.cbh' && e.status === 'candidate' && dirname(e.path) === dirname(entry.path));
  if (equivalents.length) Object.assign(entry, { status: 'alternative', reason: 'possible-unpacked-equivalent', equivalents: equivalents.map(e => e.locator), uncertain: true });
 }
 return entries;
}
export function loadRegistry(path) {
 if (!path) return { version:1, books:[] };
 let registry;
 try { registry = JSON.parse(readFileSync(path,'utf8')); }
 catch (error) { if (error.code === 'ENOENT') return { version:1, books:[] }; throw error; }
 if (registry.version !== 1 || !Array.isArray(registry.books)) throw new Error('Unsupported registry');
 const keys = new Set();
 for (const b of registry.books) for (const d of b.databases) {
  if (!d.source_key || keys.has(d.source_key)) throw new Error('Missing/duplicate catalogue identity');
  keys.add(d.source_key);
 }
 return registry;
}
// A proposal only: inspect and dry-run never publish it. Explicit path mappings
// also support older standalone source keys; no key prefix is rewritten.
export function resolveSources(entries, registry, { sourceKey, mappings = {}, register = false } = {}) {
 const proposed = structuredClone(registry), candidates = entries.filter(e => e.status === 'candidate');
 if (sourceKey && candidates.length !== 1) throw new Error('--source-key requires exactly one candidate');
 for (const entry of candidates) {
  const folder = entry.locator.includes('/') ? entry.locator.split('/')[0] : '';
  let b = proposed.books.find(b => b.folder === folder);
  let d = proposed.books.flatMap(b => b.databases).find(d => d.locator === entry.locator) ?? b?.databases.find(d => d.file === entry.locator.slice(folder ? folder.length + 1 : 0));
  const explicit = mappings[entry.locator]?.sourceKey ?? sourceKey;
  if (!d && entry.revision) {
   const matches = proposed.books.flatMap(b => b.databases).filter(d => d.revision?.sha256 === entry.revision.sha256);
   if (matches.length === 1) d = matches[0];
   else if (matches.length > 1 && !explicit) throw new Error('Ambiguous source revision: ' + entry.locator);
  }
  if (d && explicit && d.source_key !== explicit) throw new Error('Contradictory source mapping: ' + entry.locator);
  if (!d && register) {
   if (!b) { b = { number: Math.max(0,...proposed.books.map(b => b.number)) + 1, folder, databases:[] }; proposed.books.push(b); }
   const number = Math.max(0,...b.databases.map(d => d.number)) + 1;
   d = { number, file: entry.locator.slice(folder ? folder.length + 1 : 0), source_key: explicit ?? `book:catalog:chessbase-${String(b.number).padStart(4,'0')}:db-${String(number).padStart(3,'0')}` };
   b.databases.push(d);
  }
  entry.sourceKey = d?.source_key ?? explicit ?? null;
  if (d && register) { d.revision = entry.revision; d.locator = entry.locator; }
 }
 const keys = candidates.map(e => e.sourceKey).filter(Boolean);
 if (new Set(keys).size !== keys.length) throw new Error('Multiple inputs resolve to one source; reconcile first');
 return proposed;
}

// Reconciliation maps incoming keys to a reviewed old key + expected old checksum.
// A changed record without evidence is refused, even when its ordinal is stable.
export function reconcileRecord(record, previous, allPrevious, mapping) {
 if (mapping) {
  const old = allPrevious.get(mapping.key);
  if (!old || old.pgn_sha256 !== mapping.expectedSha256) return { conflict: 'stale-reconciliation' };
  return { key: mapping.key, reconciled: true };
 }
 if (previous?.pgn_sha256 === record.pgn_sha256) return { key: record.key };
 const matches = [...allPrevious.values()].filter(p => p.pgn_sha256 === record.pgn_sha256);
 if (matches.length) return { conflict: 'record-order-or-number-drift', candidates: matches.map(p => p.key) };
 if (previous) return { conflict: 'changed-record-requires-reconciliation' };
 return { key: record.key };
}
