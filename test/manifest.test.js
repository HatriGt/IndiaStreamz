const test = require('node:test');
const assert = require('node:assert/strict');

const manifest = require('../src/addon/manifest');
const { getManifestForCatalogs } = require('../src/addon/manifest');
const constants = require('../src/utils/constants');

function seriesCatalog(m) {
  return m.catalogs.find((c) => c.id === 'series' && c.type === 'series');
}
function seriesLangOptions(m) {
  return seriesCatalog(m).extra.find((e) => e.name === 'language').options;
}

test('no args: returns full manifest untouched', () => {
  const m = getManifestForCatalogs();
  assert.equal(m, manifest); // same reference when nothing to filter
});

test('series dropdown always offers the full language option list', () => {
  // The dropdown is never narrowed by config; content is limited in the handler.
  assert.deepEqual(seriesLangOptions(getManifestForCatalogs()), constants.CATALOG_LANGUAGE_OPTIONS);
  assert.deepEqual(seriesLangOptions(getManifestForCatalogs(['series'])), constants.CATALOG_LANGUAGE_OPTIONS);
});

test('visibleCatalogs filters catalog list (movies)', () => {
  const m = getManifestForCatalogs(['tamil', 'telugu']);
  assert.deepEqual(m.catalogs.map((c) => c.id).sort(), ['tamil', 'telugu']);
});

test('visibleCatalogs can include the series catalog', () => {
  const m = getManifestForCatalogs(['tamil', 'series']);
  assert.deepEqual(m.catalogs.map((c) => c.id).sort(), ['series', 'tamil']);
});
