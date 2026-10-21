import { inventoryArchive } from '../lib/import/inventory.mjs';
if (!process.argv[2]) { console.error('Usage: node scripts/run-archive-tool.mjs scripts/inventory-games.mjs ARCHIVE [ARCHIVE ...]'); process.exitCode = 1; }
else for (const path of process.argv.slice(2)) {
  try { console.log(JSON.stringify({ path, ...inventoryArchive(path) }, null, 2)); }
  catch (error) { console.error(`${path}: ${error.message}`); process.exitCode = 1; }
}
