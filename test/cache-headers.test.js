const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCacheControl, applyCacheHeaders, applyStreamCacheHeaders } = require('../src/utils/cache-headers');
const constants = require('../src/utils/constants');

function mockRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; }
  };
}

test('buildCacheControl assembles directives', () => {
  const value = buildCacheControl({ cacheMaxAge: 3600, staleRevalidate: 14400, staleError: 86400 });
  assert.equal(value, 'max-age=3600, stale-while-revalidate=14400, stale-if-error=86400');
});

test('buildCacheControl returns null for empty input', () => {
  assert.equal(buildCacheControl({}), null);
});

test('applyCacheHeaders sets Cache-Control from result', () => {
  const res = mockRes();
  applyCacheHeaders(res, { metas: [], cacheMaxAge: 3600 });
  assert.equal(res.headers['Cache-Control'], 'max-age=3600');
});

test('applyStreamCacheHeaders: no-store for per-user URLs', () => {
  const res = mockRes();
  applyStreamCacheHeaders(res, { streams: [{ url: 'https://torbox/stream' }] });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('applyStreamCacheHeaders: short cache for generic infoHash streams', () => {
  const res = mockRes();
  applyStreamCacheHeaders(res, { streams: [{ infoHash: 'abc' }] });
  assert.equal(res.headers['Cache-Control'], `max-age=${constants.STREAM_CACHE_MAX_AGE}`);
});
