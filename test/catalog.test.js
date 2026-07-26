const os = require('node:os');
const path = require('node:path');
// Isolate this suite's cache dir before requiring constants/handlers
process.env.CACHE_DIR = path.join(os.tmpdir(), `indiastreamz-catalog-${process.pid}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const constants = require('../src/utils/constants');
const catalogHandler = require('../src/addon/catalog-handler');
const fileCache = require('../src/cache/file-cache');

const catalogsDir = path.resolve(constants.CACHE_CATALOGS_DIR);
const tamilFile = path.join(catalogsDir, 'tamil.json');

// Build a catalog with 150 movies so we can assert 100-item pagination
function seedCatalog() {
  fs.mkdirSync(catalogsDir, { recursive: true });
  const items = [];
  for (let i = 0; i < 150; i++) {
    items.push({
      id: `tamil-movie-${i}`,
      type: 'movie',
      name: `Movie ${i}`,
      genres: i % 2 === 0 ? ['Action'] : ['Comedy']
    });
  }
  fs.writeFileSync(tamilFile, JSON.stringify(items), 'utf8');
  fileCache.clearCatalogCache('tamil');
}

test.before(() => seedCatalog());

test('catalog returns cache directives', async () => {
  const res = await catalogHandler({ type: 'movie', id: 'tamil', extra: {} });
  assert.equal(res.cacheMaxAge, constants.CATALOG_CACHE_MAX_AGE);
  assert.equal(res.staleRevalidate, constants.CATALOG_STALE_REVALIDATE);
  assert.equal(res.staleError, constants.CATALOG_STALE_ERROR);
});

test('catalog paginates to PAGE_SIZE items', async () => {
  const page1 = await catalogHandler({ type: 'movie', id: 'tamil', extra: {} });
  assert.equal(page1.metas.length, constants.PAGE_SIZE);
  assert.equal(page1.metas[0].id, 'tamil-movie-0');

  const page2 = await catalogHandler({ type: 'movie', id: 'tamil', extra: { skip: '100' } });
  assert.equal(page2.metas.length, 50); // remainder
  assert.equal(page2.metas[0].id, 'tamil-movie-100');
});

test('catalog filters by genre', async () => {
  const res = await catalogHandler({ type: 'movie', id: 'tamil', extra: { genre: 'Action' } });
  assert.ok(res.metas.length > 0);
  assert.ok(res.metas.every(m => m.genres.includes('Action')));
});

test('catalog filters by search', async () => {
  const res = await catalogHandler({ type: 'movie', id: 'tamil', extra: { search: 'Movie 1' } });
  assert.ok(res.metas.length > 0);
  assert.ok(res.metas.every(m => m.name.toLowerCase().includes('movie 1')));
});

test('invalid language returns empty', async () => {
  const res = await catalogHandler({ type: 'movie', id: 'klingon', extra: {} });
  assert.deepEqual(res.metas, []);
});

test.after(() => {
  try { fs.unlinkSync(tamilFile); } catch { /* ignore */ }
});
