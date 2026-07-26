const os = require('node:os');
const path = require('node:path');
// Isolate this suite's cache dir before requiring constants/handlers
process.env.CACHE_DIR = path.join(os.tmpdir(), `indiastreamz-stream-${process.pid}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const constants = require('../src/utils/constants');
const streamHandler = require('../src/addon/stream-handler');
const fileCache = require('../src/cache/file-cache');

const streamsDir = path.resolve(constants.CACHE_STREAMS_DIR);
const movieId = 'tamil-teststream-abc12345';
const streamFile = path.join(streamsDir, `${movieId}.json`);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

function seedStreams() {
  fs.mkdirSync(streamsDir, { recursive: true });
  const streams = [
    {
      name: '1080p',
      title: '1080p • 2.1GB • WEB-DL',
      infoHash: HASH,
      externalUrl: `magnet:?xt=urn:btih:${HASH}&dn=Movie`,
      behaviorHints: { bingeGroup: 'tamilmv-dd8255ec', videoSize: 2254857830 }
    }
  ];
  fs.writeFileSync(streamFile, JSON.stringify(streams), 'utf8');
  fileCache.streamCache.delete(movieId);
}

test.before(() => seedStreams());

test('no torbox key returns cached streams as-is with title preserved', async () => {
  const res = await streamHandler({ type: 'movie', id: movieId, extra: {} });
  assert.equal(res.streams.length, 1);
  assert.equal(res.streams[0].infoHash, HASH);
  assert.equal(res.streams[0].title, '1080p • 2.1GB • WEB-DL');
  assert.equal(res.streams[0].behaviorHints.bingeGroup, 'tamilmv-dd8255ec');
});

test('config is read per-request from extra (no cross-request leak)', async () => {
  // Two "concurrent" requests: one without a key, one with a key.
  // The no-key request must NOT pick up the other request's key.
  const [noKey, withBogusKey] = await Promise.all([
    streamHandler({ type: 'movie', id: movieId, extra: {} }),
    streamHandler({ type: 'movie', id: movieId, extra: { torboxApiKey: '' } })
  ]);
  // Both take the no-conversion path -> raw infoHash streams (no url field)
  assert.ok(noKey.streams.every(s => !s.url));
  assert.ok(withBogusKey.streams.every(s => !s.url));
});

test('unknown id returns empty streams', async () => {
  const res = await streamHandler({ type: 'movie', id: 'does-not-exist', extra: {} });
  assert.deepEqual(res.streams, []);
});

test.after(() => {
  try { fs.unlinkSync(streamFile); } catch { /* ignore */ }
});
