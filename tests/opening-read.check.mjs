import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureArchive, catalogueFiles } from './fixtures/opening-archive.mjs';
import { buildCatalogue } from '../electron/openings.mjs';
import { enrichOpenings } from '../electron/opening-enrichment.mjs';
import { ChessArchive } from '../electron/database.mjs';

test('opening APIs include descendants/transpositions with unique counts and current labels', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'opening-read-'));
  let archive, db;
  try {
    const path = join(directory, 'test.db');
    db = fixtureArchive(path, ['1.e4 e5 2.Nf3 Nc6 *', '1.e4 e5 2.Nf3 *', '1.Nf3 Nf6 2.d4 d5 *', '1.h3 *', '1.e4 e5 2.Bh6 *']);
    archive = new ChessArchive(path);
    assert.equal(archive.openingFacets().revision, null);
    assert.equal(archive.searchGames({ kind: 'game' }).total, 5);
    const input = { catalogue: buildCatalogue(catalogueFiles), manifest: { commit: 'a'.repeat(40) }, checksum: 'fixture' };
    await enrichOpenings(path, input);
    const facets = archive.openingFacets();
    assert.equal(facets.classified, 3); assert.equal(facets.unclassified, 2);
    const family = facets.nodes.find(node => node.label === 'Open Game');
    const line = facets.nodes.find(node => node.label === 'Knight Line');
    const subline = facets.nodes.find(node => node.label === 'Two Knights');
    assert.equal(family.count, 2); assert.equal(line.count, 2); assert.equal(subline.count, 1);
    assert.equal(archive.searchGames({ openingNodeId: family.id, pageSize: 1 }).total, 2);
    assert.equal(archive.searchGames({ openingNodeId: family.id, pageSize: 1, page: 2 }).rows[0].id, 2);
    const exact = archive.searchGames({ openingNodeId: subline.id });
    assert.equal(exact.total, 1); assert.equal(exact.rows[0].opening.name, 'Open Game: Knight Line, Two Knights');
    assert.equal(exact.rows[0].eco, 'A00'); assert.equal(exact.rows[0].opening.eco, 'C44');
    assert.equal(archive.getGame(1).opening.matchedPly, 4);
    assert.equal(archive.searchGames({ openingNodeId: 'unclassified' }).total, 2);
    assert.equal(archive.openingFacets({ openingNodeId: subline.id }).classified, 3, 'Facet counts exclude the current opening filter');
    assert.equal(archive.openingFacets({ properties:{white:['1']} }).classified, 1);
    assert.equal(archive.searchGames({ openingNodeId: family.id, properties:{white:['1'],source:['1'],eco:['A00']} }).total, 1);
    assert.equal(archive.searchGames({ openingNodeId: family.id, yearFrom: '2000' }).total, 0);
    assert.throws(() => archive.searchGames({ openingNodeId: "' OR 1=1 --" }), /Invalid or stale/);
    assert.throws(() => archive.searchGames({ openingNodeId: {} }), /Invalid or stale/);
    // Earlier named lines still filter a game with a different deepest label.
    assert.equal(archive.searchGames({ openingNodeId: facets.nodes.find(node => node.label === 'King Pawn').id }).total, 2);
    assert.equal(archive.searchGames({ openingNodeId: facets.nodes.find(node => node.label === 'Setup').id }).total, 1);
    db.prepare('UPDATE games SET pgn_sha256=? WHERE id=1').run('b'.repeat(64));
    assert.equal(archive.searchGames({ openingNodeId: subline.id }).total, 0);
    assert.equal(archive.searchGames({ openingNodeId: 'unclassified' }).total, 3);
    assert.equal(archive.searchGames({ properties:{white:['1']} }).rows[0].opening.status, 'unenriched');
    // List labels must not decode the stale/corrupt PGN.
    assert.throws(() => archive.getGame(1), /SHA-256/);
    archive.close(); archive = null;
    for(const version of [3,4,5,6,99]) {db.pragma('user_version='+version);assert.throws(()=>new ChessArchive(path),/schema 7/);}
  } finally { archive?.close(); db?.close(); rmSync(directory, { recursive: true, force: true }); }
});
