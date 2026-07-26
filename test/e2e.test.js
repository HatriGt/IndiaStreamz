const os = require('node:os');
const path = require('node:path');
// Isolate this suite's cache dir before requiring constants/handlers
process.env.CACHE_DIR = path.join(os.tmpdir(), `indiastreamz-e2e-${process.pid}-${Date.now()}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

const constants = require('../src/utils/constants');
const manifest = require('../src/addon/manifest');
const catalogHandler = require('../src/addon/catalog-handler');
const metaHandler = require('../src/addon/meta-handler');
const streamHandler = require('../src/addon/stream-handler');
const fileCache = require('../src/cache/file-cache');
const { applyCacheHeaders, applyStreamCacheHeaders } = require('../src/utils/cache-headers');

const catalogsDir = path.resolve(constants.CACHE_CATALOGS_DIR);
const moviesDir = path.resolve(constants.CACHE_MOVIES_DIR);
const streamsDir = path.resolve(constants.CACHE_STREAMS_DIR);
const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const movieId = 'tamil-e2e-movie-abcd1234';

// Build a minimal app that mounts the same handlers + cache-header logic as
// server.js, but WITHOUT the cron scheduler / network scraping.
function buildApp() {
  const app = express();
  app.get('/manifest.json', (req, res) => res.json(manifest));
  app.get('/catalog/:type/:id.json', async (req, res) => {
    const data = await catalogHandler({ type: req.params.type, id: req.params.id, extra: req.query });
    applyCacheHeaders(res, data);
    res.json(data);
  });
  app.get('/meta/:type/:id.json', async (req, res) => {
    const data = await metaHandler({ type: req.params.type, id: req.params.id });
    applyCacheHeaders(res, data);
    res.json(data);
  });
  app.get('/stream/:type/:id.json', async (req, res) => {
    const data = await streamHandler({ type: req.params.type, id: req.params.id, extra: {} });
    applyStreamCacheHeaders(res, data);
    res.json(data);
  });
  return app;
}

function seed() {
  fs.mkdirSync(catalogsDir, { recursive: true });
  fs.mkdirSync(moviesDir, { recursive: true });
  fs.mkdirSync(streamsDir, { recursive: true });

  fs.writeFileSync(path.join(catalogsDir, 'tamil.json'), JSON.stringify([
    { id: movieId, type: 'movie', name: 'E2E Movie', genres: ['Action'] }
  ]), 'utf8');
  fs.writeFileSync(path.join(moviesDir, `${movieId}.json`), JSON.stringify({
    id: movieId, type: 'movie', name: 'E2E Movie', genres: ['Action']
  }), 'utf8');
  fs.writeFileSync(path.join(streamsDir, `${movieId}.json`), JSON.stringify([
    { name: '1080p', title: '1080p • 2GB', infoHash: HASH, externalUrl: `magnet:?xt=urn:btih:${HASH}` }
  ]), 'utf8');
  fileCache.clearAllCaches();
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

let server;
let port;

test.before(async () => {
  seed();
  server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});

test('GET /manifest.json returns valid manifest with genre options', async () => {
  const res = await get(port, '/manifest.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, constants.ADDON_ID);
  assert.ok(Array.isArray(res.body.catalogs) && res.body.catalogs.length > 0);
  const genreExtra = res.body.catalogs[0].extra.find((e) => e.name === 'genre');
  assert.ok(Array.isArray(genreExtra.options) && genreExtra.options.includes('Action'));
});

test('GET /catalog returns metas with Cache-Control', async () => {
  const res = await get(port, '/catalog/movie/tamil.json');
  assert.equal(res.status, 200);
  assert.ok(res.body.metas.length >= 1);
  assert.match(res.headers['cache-control'], /max-age=/);
});

test('GET /meta returns the movie with 24h cache', async () => {
  const res = await get(port, `/meta/movie/${movieId}.json`);
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.id, movieId);
  assert.equal(res.headers['cache-control'], `max-age=${constants.META_CACHE_MAX_AGE}`);
});

test('GET /stream returns streams with short cache (no user URL)', async () => {
  const res = await get(port, `/stream/movie/${movieId}.json`);
  assert.equal(res.status, 200);
  assert.equal(res.body.streams[0].infoHash, HASH);
  assert.equal(res.headers['cache-control'], `max-age=${constants.STREAM_CACHE_MAX_AGE}`);
});

test.after(() => {
  if (server) server.close();
  try { fs.unlinkSync(path.join(catalogsDir, 'tamil.json')); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(moviesDir, `${movieId}.json`)); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(streamsDir, `${movieId}.json`)); } catch { /* ignore */ }
});
