const os = require('node:os');
const path = require('node:path');
// Isolate cache dir before requiring constants/file-cache
process.env.CACHE_DIR = path.join(os.tmpdir(), `indiastreamz-sanitize-${process.pid}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const constants = require('../src/utils/constants');
const { sanitizeMeta, sanitizeString } = require('../src/utils/sanitize-meta');
const fileCache = require('../src/cache/file-cache');
const metaHandler = require('../src/addon/meta-handler');

// Ensure cache dirs exist before writing (matches how other suites seed).
test.before(() => {
  fs.mkdirSync(constants.CACHE_MOVIES_DIR, { recursive: true });
  fs.mkdirSync(constants.CACHE_CATALOGS_DIR, { recursive: true });
  fs.mkdirSync(constants.CACHE_STREAMS_DIR, { recursive: true });
});

test('sanitizeString strips zero-width chars and trims', () => {
  assert.equal(sanitizeString('\u200BCon\u200D City\uFEFF '), 'Con City');
});

test('sanitizeMeta preserves id but cleans nested strings', () => {
  const dirty = {
    id: 'movie\u200B-1', // id must NOT be altered
    name: '\u200BJana Nayagan\uFEFF',
    genres: ['Act\u200Dion'],
    videos: [{ title: 'Trailer\u00AD' }]
  };
  const clean = sanitizeMeta(dirty);
  assert.equal(clean.id, 'movie\u200B-1'); // untouched
  assert.equal(clean.name, 'Jana Nayagan');
  assert.equal(clean.genres[0], 'Action');
  assert.equal(clean.videos[0].title, 'Trailer');
});

test('file-cache sanitizes meta at write-time; handler echoes clean data', async () => {
  const id = 'tamil-sanitize-test-abc123';
  await fileCache.setAll({
    movies: { [id]: { id, type: 'movie', name: '\u200BSupergirl\uFEFF', description: 'Hero\u00AD movie' } }
  });
  const res = await metaHandler({ type: 'movie', id });
  assert.equal(res.meta.id, id);
  assert.equal(res.meta.name, 'Supergirl');
  assert.equal(res.meta.description, 'Hero movie');
});
