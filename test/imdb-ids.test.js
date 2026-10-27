const os = require('node:os');
const path = require('node:path');
// Isolate this suite's cache dir before requiring constants/handlers
process.env.CACHE_DIR = path.join(os.tmpdir(), `indiastreamz-imdb-${process.pid}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const constants = require('../src/utils/constants');
const streamHandler = require('../src/addon/stream-handler');
const catalogHandler = require('../src/addon/catalog-handler');
const metaHandler = require('../src/addon/meta-handler');
const manifest = require('../src/addon/manifest');
const fileCache = require('../src/cache/file-cache');

const H1 = 'aa8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const H2 = 'bb8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const magnet = (h, q) => `magnet:?xt=urn:btih:${h}&dn=Movie.${q}&tr=udp%3A%2F%2Ftracker.example%3A1337`;

function write(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data), 'utf8');
}

test.before(() => {
  const cats = path.resolve(constants.CACHE_CATALOGS_DIR);
  const movies = path.resolve(constants.CACHE_MOVIES_DIR);
  const streams = path.resolve(constants.CACHE_STREAMS_DIR);
  // Same film released in two language catalogs -> one IMDb id
  write(cats, 'tamil', [
    { id: 'tamil-film-1', type: 'movie', name: 'Film', imdb_id: 'tt0000001' },
    { id: 'tamil-show-s2-x', type: 'series', name: 'Show', imdb_id: 'tt0000002', season: 2, languages: ['tamil'] },
    { id: 'tamil-noimdb-1', type: 'movie', name: 'No IMDb' }
  ]);
  write(cats, 'telugu', [
    { id: 'telugu-film-1', type: 'movie', name: 'Film', imdb_id: 'tt0000001' }
  ]);
  write(streams, 'tamil-film-1', [{ name: '720p', infoHash: H1, externalUrl: magnet(H1, '720p') }]);
  write(streams, 'telugu-film-1', [
    { name: '2160p', infoHash: H2, externalUrl: magnet(H2, '2160p') },
    { name: '720p', infoHash: H1, externalUrl: magnet(H1, '720p') } // duplicate
  ]);
  write(streams, 'tamil-show-s2-x:2:3', [{ name: 'S2E3 - 1080p', infoHash: H1, externalUrl: magnet(H1, '1080p') }]);
  write(movies, 'tamil-show-s2-x', {
    id: 'tamil-show-s2-x', type: 'series', name: 'Show',
    videos: [{ id: 'tamil-show-s2-x:2:3', season: 2, episode: 3 }]
  });
  fileCache.clearAllCaches();
});

test('manifest answers streams for tt ids but meta only for internal ids', () => {
  const meta = manifest.resources.find((r) => r.name === 'meta');
  const stream = manifest.resources.find((r) => r.name === 'stream');
  assert.ok(!meta.idPrefixes.includes('tt'));
  assert.ok(stream.idPrefixes.includes('tt'));
});

test('catalog exposes IMDb ids and dedupes releases sharing one', async () => {
  const res = await catalogHandler({ type: 'movie', id: 'tamil', extra: {} });
  assert.deepEqual(res.metas.map((m) => m.id), ['tt0000001', 'tamil-noimdb-1']);
  const series = await catalogHandler({ type: 'series', id: 'series', extra: {} });
  assert.equal(series.metas[0].id, 'tt0000002');
  assert.equal(series.metas[0].season, undefined);
});

test('movie tt id merges streams across releases, best quality first, one source each', async () => {
  const res = await streamHandler({ type: 'movie', id: 'tt0000001', extra: {} });
  assert.deepEqual(res.streams.map((s) => s.infoHash), [H2, H1]);
  for (const s of res.streams) {
    assert.equal(s.externalUrl, undefined);
    assert.ok(s.sources.includes('tracker:udp://tracker.example:1337'));
    assert.ok(s.sources.includes(`dht:${s.infoHash}`));
  }
});

test('series tt:season:episode resolves to the matching season entry', async () => {
  const hit = await streamHandler({ type: 'series', id: 'tt0000002:2:3', extra: {} });
  assert.equal(hit.streams.length, 1);
  const miss = await streamHandler({ type: 'series', id: 'tt0000002:1:3', extra: {} });
  assert.deepEqual(miss.streams, []);
});

test('meta for a tt id re-keys episode ids to the tt id', async () => {
  const res = await metaHandler({ type: 'series', id: 'tt0000002' });
  assert.equal(res.meta.id, 'tt0000002');
  assert.equal(res.meta.videos[0].id, 'tt0000002:2:3');
});

test('qualityRank orders 4K above 1080p above unknown', () => {
  const { qualityRank } = streamHandler;
  assert.ok(qualityRank('✅ 4K') > qualityRank('S1E2 - 1080p'));
  assert.ok(qualityRank('1080p') > qualityRank('CAM'));
});

test.after(() => {
  fs.rmSync(process.env.CACHE_DIR, { recursive: true, force: true });
});

test('slow TorBox is capped by the stream budget; uncached streams use the proxy URL only', async () => {
  const TorboxClient = require('../src/integrations/torbox-client');
  const orig = { mylist: TorboxClient.prototype.getMyTorrents, batch: TorboxClient.prototype.checkCachedBatch };
  TorboxClient.prototype.getMyTorrents = () => new Promise(() => {}); // never resolves
  TorboxClient.prototype.checkCachedBatch = async () => new Map([[H2, true]]);
  const budget = constants.STREAM_TORBOX_BUDGET_MS;
  constants.STREAM_TORBOX_BUDGET_MS = 50;
  try {
    const started = Date.now();
    const res = await streamHandler({
      type: 'movie',
      id: 'tt0000001',
      extra: { torboxApiKey: 'k', token: 't', encrypted: 'e', baseUrl: 'https://x' }
    });
    assert.ok(Date.now() - started < 1000);
    const [cached, uncached] = res.streams;
    assert.ok(cached.name.startsWith('✅'));
    assert.ok(uncached.name.startsWith('⏳'));
    for (const s of res.streams) {
      assert.ok(s.url.startsWith('https://x/stremio/t/e/proxy/'));
      assert.equal(s.infoHash, undefined);
      assert.equal(s.externalUrl, undefined);
    }
  } finally {
    TorboxClient.prototype.getMyTorrents = orig.mylist;
    TorboxClient.prototype.checkCachedBatch = orig.batch;
    constants.STREAM_TORBOX_BUDGET_MS = budget;
  }
});
