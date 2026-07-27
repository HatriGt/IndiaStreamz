const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCatalogWildcard } = require('../src/utils/catalog-path');

test('simple catalog id, no extra', () => {
  const { id, extra } = parseCatalogWildcard('tamil.json', {});
  assert.equal(id, 'tamil');
  assert.deepEqual(extra, {});
});

test('parses language filter from querystring-in-path', () => {
  const { id, extra } = parseCatalogWildcard('series/language=Tamil.json', {});
  assert.equal(id, 'series');
  assert.equal(extra.language, 'Tamil');
});

test('parses multiple filters (language + skip)', () => {
  const { id, extra } = parseCatalogWildcard('series/language=Telugu&skip=100.json', {});
  assert.equal(id, 'series');
  assert.equal(extra.language, 'Telugu');
  assert.equal(extra.skip, '100');
});

test('decodes percent-encoded search values', () => {
  const { id, extra } = parseCatalogWildcard('tamil/search=game%20of%20thrones.json', {});
  assert.equal(id, 'tamil');
  assert.equal(extra.search, 'game of thrones');
});

test('merges real query params too', () => {
  const { id, extra } = parseCatalogWildcard('series/language=Hindi.json', { skip: '50' });
  assert.equal(id, 'series');
  assert.equal(extra.language, 'Hindi');
  assert.equal(extra.skip, '50');
});

test('handles missing .json extension', () => {
  const { id, extra } = parseCatalogWildcard('series/genre=Action', {});
  assert.equal(id, 'series');
  assert.equal(extra.genre, 'Action');
});
