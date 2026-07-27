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
const teluguFile = path.join(catalogsDir, 'telugu.json');

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
  // Series live alongside movies in the per-language catalog files. One shared
  // series (S-shared) is multi-language (tamil+telugu) to test dedupe.
  items.push({ id: 'tamil-series-A', type: 'series', name: 'Tamil Series A', genres: ['Drama'], languages: ['tamil'] });
  items.push({ id: 'series-shared', type: 'series', name: 'Shared Series', genres: ['Action'], languages: ['tamil', 'telugu'] });
  fs.writeFileSync(tamilFile, JSON.stringify(items), 'utf8');

  fs.writeFileSync(teluguFile, JSON.stringify([
    { id: 'telugu-movie-0', type: 'movie', name: 'Telugu Movie', genres: ['Action'] },
    { id: 'telugu-series-B', type: 'series', name: 'Telugu Series B', genres: ['Comedy'], languages: ['telugu'] },
    { id: 'series-shared', type: 'series', name: 'Shared Series', genres: ['Action'], languages: ['tamil', 'telugu'] }
  ]), 'utf8');

  fileCache.clearCatalogCache('tamil');
  fileCache.clearCatalogCache('telugu');
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

// --- Consolidated series catalog ---

test('series catalog with no language shows ALL series, deduped', async () => {
  const res = await catalogHandler({ type: 'series', id: 'series', extra: {} });
  const ids = res.metas.map(m => m.id).sort();
  // A (tamil), B (telugu), shared (appears once despite being in both files)
  assert.deepEqual(ids, ['series-shared', 'tamil-series-A', 'telugu-series-B']);
});

test("series catalog language='All' behaves like no filter", async () => {
  const res = await catalogHandler({ type: 'series', id: 'series', extra: { language: 'All' } });
  assert.equal(res.metas.length, 3);
});

test('series catalog filters by language (Tamil)', async () => {
  const res = await catalogHandler({ type: 'series', id: 'series', extra: { language: 'Tamil' } });
  const ids = res.metas.map(m => m.id).sort();
  assert.deepEqual(ids, ['series-shared', 'tamil-series-A']); // shared is tamil+telugu
});

test('series catalog filters by language (Telugu)', async () => {
  const res = await catalogHandler({ type: 'series', id: 'series', extra: { language: 'Telugu' } });
  const ids = res.metas.map(m => m.id).sort();
  assert.deepEqual(ids, ['series-shared', 'telugu-series-B']);
});

test('series catalog language + genre filters combine', async () => {
  const res = await catalogHandler({ type: 'series', id: 'series', extra: { language: 'Tamil', genre: 'Action' } });
  const ids = res.metas.map(m => m.id);
  assert.deepEqual(ids, ['series-shared']); // only shared is Tamil AND Action
});

test('series catalog returns cache directives', async () => {
  const res = await catalogHandler({ type: 'series', id: 'series', extra: {} });
  assert.equal(res.cacheMaxAge, constants.CATALOG_CACHE_MAX_AGE);
});

test.after(() => {
  try { fs.unlinkSync(tamilFile); } catch { /* ignore */ }
  try { fs.unlinkSync(teluguFile); } catch { /* ignore */ }
});
